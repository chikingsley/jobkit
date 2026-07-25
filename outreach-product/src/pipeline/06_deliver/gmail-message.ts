import type { AppEnv } from "../../../worker/env";
import { validateApplicationMessageOpening } from "../04_compose/application-message-policy";

const CRLF = "\r\n";
const MAX_RAW_ATTACHMENT_BYTES = 18 * 1024 * 1024;
const ASCII_HEADER_PATTERN = /^[\x20-\x7E]*$/u;
const BASE64_PADDING_PATTERN = /[=]+$/u;
const HEADER_NEWLINE_PATTERN = /[\r\n]/u;
const HEADER_NAME_PATTERN = /^[A-Za-z0-9-]+$/u;

interface DraftAttachmentRow {
  category: string;
  content_type: string;
  document_packet_manifest_json: string;
  etag: string;
  filename: string;
  message: string;
  object_key: string;
  position: number;
  r2_version: string;
  required_opening: string;
  size_bytes: number;
}

interface CampaignAttachmentRow {
  category: string;
  content_type: string;
  document_packet_manifest_json: string;
  etag: string;
  filename: string;
  message: string;
  object_key: string;
  position: number;
  r2_version: string;
  size_bytes: number;
}

interface SnapshotAttachmentRow {
  category: string;
  content_type: string;
  etag: string;
  filename: string;
  object_key: string;
  r2_version: string;
  size_bytes: number;
}

export interface GmailEnvelope {
  from: string;
  subject: string;
  to: string;
}

export interface MimeAttachment {
  bytes: Uint8Array;
  contentType: string;
  filename: string;
}

export interface GmailMessagePayload {
  attachmentCount: number;
  filenames: string[];
  raw: string;
}

export class GmailMessagePayloadError extends Error {}

export async function buildGmailMessagePayload(
  env: AppEnv,
  userId: string,
  draftId: string,
  envelope: GmailEnvelope
): Promise<GmailMessagePayload> {
  const rows = await env.DB.prepare(
    `SELECT d.message,d.document_packet_manifest_json,d.required_opening,
            a.position,a.category,
            a.filename,a.object_key,a.content_type,
            a.size_bytes,a.r2_version,a.etag
       FROM application_drafts d
       JOIN user_listing_states uj ON uj.id=d.user_job_id
       LEFT JOIN application_draft_attachments a ON a.draft_id=d.id
      WHERE d.id=? AND uj.user_id=? ORDER BY a.position`
  )
    .bind(draftId, userId)
    .all<DraftAttachmentRow>();
  const [first] = rows.results;
  if (!first) {
    throw new GmailMessagePayloadError("Application draft not found");
  }
  const applicationMessage = validateApplicationMessageOpening(
    first.message,
    first.required_opening
  );
  return buildSnapshotGmailPayload(
    env,
    envelope,
    applicationMessage,
    first.document_packet_manifest_json,
    rows.results.filter((row) => row.object_key)
  );
}

export async function buildCampaignGmailMessagePayload(
  env: AppEnv,
  userId: string,
  dispatchId: string,
  envelope: GmailEnvelope
): Promise<GmailMessagePayload> {
  const rows = await env.DB.prepare(
    `SELECT m.message,d.document_packet_manifest_json,
            a.position,a.category,a.filename,a.object_key,a.content_type,
            a.size_bytes,a.r2_version,a.etag
       FROM campaign_dispatches d
       JOIN campaigns c ON c.id=d.campaign_id
       JOIN campaign_messages m ON m.dispatch_id=d.id AND m.status='approved'
       LEFT JOIN campaign_dispatch_attachments a ON a.dispatch_id=d.id
      WHERE d.id=? AND c.user_id=?
        AND m.version=(
          SELECT MAX(latest.version) FROM campaign_messages latest
           WHERE latest.dispatch_id=d.id AND latest.status='approved'
        )
      ORDER BY a.position`
  )
    .bind(dispatchId, userId)
    .all<CampaignAttachmentRow>();
  const [first] = rows.results;
  if (!first) {
    throw new GmailMessagePayloadError(
      "Approved campaign message was not found"
    );
  }
  return buildSnapshotGmailPayload(
    env,
    envelope,
    first.message.trim(),
    first.document_packet_manifest_json,
    rows.results.filter((row) => row.object_key)
  );
}

async function buildSnapshotGmailPayload(
  env: AppEnv,
  envelope: GmailEnvelope,
  message: string,
  manifestJson: string,
  attachmentRows: SnapshotAttachmentRow[]
): Promise<GmailMessagePayload> {
  if (!message) {
    throw new GmailMessagePayloadError("Email message is empty");
  }
  const expectedCategories = JSON.parse(manifestJson) as unknown;
  if (!Array.isArray(expectedCategories)) {
    throw new GmailMessagePayloadError(
      "Document packet attachment manifest is invalid"
    );
  }
  const attachedCategories = new Set(
    attachmentRows.map((attachment) => attachment.category)
  );
  const missingCategories = expectedCategories.filter(
    (category): category is string =>
      typeof category === "string" && !attachedCategories.has(category)
  );
  if (missingCategories.length > 0) {
    throw new GmailMessagePayloadError(
      `The selected attachment packet is incomplete: ${missingCategories.join(", ")}`
    );
  }
  const totalBytes = attachmentRows.reduce(
    (total, row) => total + row.size_bytes,
    0
  );
  if (totalBytes > MAX_RAW_ATTACHMENT_BYTES) {
    throw new GmailMessagePayloadError(
      "The selected attachment packet is too large for email generation"
    );
  }

  const attachments = await Promise.all(
    attachmentRows.map(async (row): Promise<MimeAttachment> => {
      const object = await env.DOCUMENTS.get(row.object_key);
      if (!object?.body) {
        throw new GmailMessagePayloadError(
          `Attachment data not found: ${row.filename}`
        );
      }
      if (object.version !== row.r2_version || object.etag !== row.etag) {
        throw new GmailMessagePayloadError(
          `Attachment version mismatch: ${row.filename}`
        );
      }
      return {
        bytes: new Uint8Array(await object.arrayBuffer()),
        contentType: row.content_type,
        filename: row.filename,
      };
    })
  );
  const rawMessage = buildRawMimeMessage(envelope, message, attachments);
  return {
    attachmentCount: attachments.length,
    filenames: attachments.map((attachment) => attachment.filename),
    raw: base64Url(new TextEncoder().encode(rawMessage)),
  };
}

export function buildRawMimeMessage(
  envelope: GmailEnvelope,
  message: string,
  attachments: MimeAttachment[],
  fixedBoundary?: string,
  extraHeaders: Readonly<Record<string, string>> = {}
): string {
  const totalAttachmentBytes = attachments.reduce(
    (total, attachment) => total + attachment.bytes.byteLength,
    0
  );
  if (totalAttachmentBytes > MAX_RAW_ATTACHMENT_BYTES) {
    throw new GmailMessagePayloadError(
      "The selected attachment packet is too large for email generation"
    );
  }
  const boundary = fixedBoundary ?? `jobkit-${crypto.randomUUID()}`;
  const headers = [
    `From: ${safeHeader(envelope.from)}`,
    `To: ${safeHeader(envelope.to)}`,
    `Subject: ${encodedHeader(envelope.subject)}`,
    ...Object.entries(extraHeaders).map(
      ([name, value]) => `${safeHeaderName(name)}: ${safeHeader(value)}`
    ),
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
  ];
  const parts = [
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    wrapBase64(base64(new TextEncoder().encode(message))),
  ];
  for (const attachment of attachments) {
    const filename = safeFilename(attachment.filename);
    parts.push(
      `--${boundary}`,
      `Content-Type: ${safeHeader(attachment.contentType)}; name="${filename}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`,
      "",
      wrapBase64(base64(attachment.bytes))
    );
  }
  parts.push(`--${boundary}--`, "");
  return [...headers, "", ...parts].join(CRLF);
}

export function gmailRaw(message: string) {
  return base64Url(new TextEncoder().encode(message));
}

function encodedHeader(value: string): string {
  const safe = safeHeader(value);
  return ASCII_HEADER_PATTERN.test(safe)
    ? safe
    : `=?UTF-8?B?${base64(new TextEncoder().encode(safe))}?=`;
}

function safeHeader(value: string): string {
  if (HEADER_NEWLINE_PATTERN.test(value)) {
    throw new GmailMessagePayloadError("Email headers cannot contain newlines");
  }
  return value.trim();
}

function safeHeaderName(value: string) {
  if (!HEADER_NAME_PATTERN.test(value)) {
    throw new GmailMessagePayloadError("Email header name is invalid");
  }
  return value;
}

function safeFilename(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[^a-z0-9._ -]/gi, "_")
    .replace(/\s+/g, " ")
    .slice(0, 120);
}

function wrapBase64(value: string): string {
  return value.match(/.{1,76}/gu)?.join(CRLF) ?? "";
}

function base64Url(bytes: Uint8Array): string {
  return base64(bytes)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(BASE64_PADDING_PATTERN, "");
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x80_00;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, offset + chunkSize)
    );
  }
  return btoa(binary);
}
