import { validateApplicationMessageOpening } from "../ai/application-message-policy";
import type { AppEnv } from "../env";

const CRLF = "\r\n";
const MAX_RAW_ATTACHMENT_BYTES = 18 * 1024 * 1024;
const ASCII_HEADER_PATTERN = /^[\x20-\x7E]*$/u;
const BASE64_PADDING_PATTERN = /[=]+$/u;
const HEADER_NEWLINE_PATTERN = /[\r\n]/u;

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
       JOIN user_jobs uj ON uj.id=d.user_job_id
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
  const attachmentRows = rows.results.filter((row) => row.object_key);
  const expectedCategories = JSON.parse(
    first.document_packet_manifest_json
  ) as unknown;
  if (!Array.isArray(expectedCategories)) {
    throw new GmailMessagePayloadError("Draft attachment manifest is invalid");
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
  const rawMessage = buildRawMimeMessage(
    envelope,
    applicationMessage,
    attachments
  );
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
  fixedBoundary?: string
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
