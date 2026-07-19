import type { AuthUser } from "../../app-types";
import type { AppEnv } from "../../env";
import { sha256 } from "../agent-tasks/run-store";
import { buildRawMimeMessage, type MimeAttachment } from "../gmail-message";
import { TestLabError } from "./errors";

interface DocumentRow {
  content_type: string;
  etag: string;
  filename: string;
  id: string;
  object_key: string;
  r2_version: string;
  size_bytes: number;
}

interface CaptureRow {
  attachments_json: string;
  created_at: string;
  id: string;
  message: string;
  mime_sha256: string;
  object_key: string;
  recipient: string;
  size_bytes: number;
  subject: string;
}

export async function listTestDelivery(db: D1Database, user: AuthUser) {
  const [allowlist, mailbox, captures, events] = await Promise.all([
    db
      .prepare(
        `SELECT email,ownership_basis,created_at FROM test_delivery_allowlist
          WHERE user_id=? ORDER BY created_at DESC`
      )
      .bind(user.id)
      .all<Record<string, unknown>>(),
    db
      .prepare(
        `SELECT email_address,status FROM gmail_mailbox_watches
          WHERE user_id=? LIMIT 1`
      )
      .bind(user.id)
      .first<{ email_address: string; status: string }>(),
    db
      .prepare(
        `SELECT * FROM test_delivery_captures
          WHERE user_id=? ORDER BY created_at DESC LIMIT 100`
      )
      .bind(user.id)
      .all<CaptureRow>(),
    db
      .prepare(
        `SELECT id,capture_id,event_type,detail,created_at
           FROM test_delivery_events
          WHERE user_id=? ORDER BY created_at DESC LIMIT 200`
      )
      .bind(user.id)
      .all<Record<string, unknown>>(),
  ]);
  return {
    allowlist: allowlist.results.map((row) => ({
      createdAt: String(row.created_at),
      email: String(row.email),
      ownershipBasis: String(row.ownership_basis),
    })),
    captures: captures.results.map((capture) => ({
      attachments: JSON.parse(capture.attachments_json) as unknown,
      createdAt: capture.created_at,
      events: events.results
        .filter((event) => event.capture_id === capture.id)
        .map((event) => ({
          createdAt: String(event.created_at),
          detail: String(event.detail),
          eventType: String(event.event_type),
          id: String(event.id),
        })),
      id: capture.id,
      message: capture.message,
      mimeSha256: capture.mime_sha256,
      recipient: capture.recipient,
      sizeBytes: capture.size_bytes,
      subject: capture.subject,
    })),
    eligibleAddresses: [
      { email: user.email, ownershipBasis: "account_email" },
      ...(mailbox?.email_address && mailbox.status === "active"
        ? [
            {
              email: mailbox.email_address,
              ownershipBasis: "gmail_mailbox",
            },
          ]
        : []),
    ].filter(
      (candidate, index, values) =>
        values.findIndex(
          (value) =>
            value.email.toLocaleLowerCase("en") ===
            candidate.email.toLocaleLowerCase("en")
        ) === index
    ),
  };
}

export async function allowTestDeliveryAddress(
  db: D1Database,
  user: AuthUser,
  email: string
) {
  const normalized = email.trim().toLocaleLowerCase("en");
  const mailbox = await db
    .prepare(
      `SELECT email_address,status FROM gmail_mailbox_watches
        WHERE user_id=? AND lower(email_address)=? LIMIT 1`
    )
    .bind(user.id, normalized)
    .first<{ email_address: string; status: string }>();
  let ownershipBasis: "account_email" | "gmail_mailbox" | null = null;
  if (normalized === user.email.trim().toLocaleLowerCase("en")) {
    ownershipBasis = "account_email";
  } else if (mailbox?.status === "active") {
    ownershipBasis = "gmail_mailbox";
  }
  if (!ownershipBasis) {
    throw new TestLabError(
      "Test delivery can only allowlist the signed-in address or active OAuth Gmail mailbox",
      409
    );
  }
  const timestamp = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO test_delivery_allowlist
        (user_id,email,ownership_basis,created_at)
       VALUES (?,?,?,?)
       ON CONFLICT(user_id,email) DO UPDATE SET
         ownership_basis=excluded.ownership_basis,
         created_at=excluded.created_at`
    )
    .bind(user.id, normalized, ownershipBasis, timestamp)
    .run();
  return { createdAt: timestamp, email: normalized, ownershipBasis };
}

export async function removeTestDeliveryAddress(
  db: D1Database,
  userId: string,
  email: string
) {
  const result = await db
    .prepare(
      "DELETE FROM test_delivery_allowlist WHERE user_id=? AND lower(email)=?"
    )
    .bind(userId, email.trim().toLocaleLowerCase("en"))
    .run();
  if ((result.meta.changes ?? 0) !== 1) {
    throw new TestLabError("Test delivery address was not allowlisted", 404);
  }
}

export async function createTestDeliveryCapture(
  env: AppEnv,
  user: AuthUser,
  input: {
    attachmentDocumentIds: string[];
    message: string;
    recipient: string;
    subject: string;
  }
) {
  await requireAllowedRecipient(env.DB, user.id, input.recipient);
  const documents = await readDocuments(
    env.DB,
    user.id,
    input.attachmentDocumentIds
  );
  const attachments = await loadAttachments(env.DOCUMENTS, documents);
  const captureId = crypto.randomUUID();
  const mime = buildRawMimeMessage(
    { from: user.email, subject: input.subject, to: input.recipient },
    input.message,
    attachments,
    `jobkit-test-${captureId}`
  );
  const objectKey = `users/${user.id}/test-lab/delivery/${captureId}.eml`;
  const bytes = new TextEncoder().encode(mime);
  const mimeSha256 = await sha256(mime);
  const createdAt = new Date().toISOString();
  await env.DOCUMENTS.put(objectKey, bytes, {
    httpMetadata: {
      contentDisposition: `attachment; filename="jobkit-test-${captureId}.eml"`,
      contentType: "message/rfc822",
    },
  });
  const attachmentMetadata = documents.map((document) => ({
    contentType: document.content_type,
    filename: document.filename,
    id: document.id,
    sizeBytes: document.size_bytes,
  }));
  try {
    await env.DB.prepare(
      `INSERT INTO test_delivery_captures
        (id,user_id,recipient,subject,message,object_key,mime_sha256,
         size_bytes,attachments_json,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    )
      .bind(
        captureId,
        user.id,
        input.recipient.trim().toLocaleLowerCase("en"),
        input.subject,
        input.message,
        objectKey,
        mimeSha256,
        bytes.byteLength,
        JSON.stringify(attachmentMetadata),
        createdAt
      )
      .run();
  } catch (error) {
    await env.DOCUMENTS.delete(objectKey);
    throw error;
  }
  return {
    attachments: attachmentMetadata,
    createdAt,
    id: captureId,
    mimeSha256,
    recipient: input.recipient.trim().toLocaleLowerCase("en"),
    sizeBytes: bytes.byteLength,
    subject: input.subject,
  };
}

export async function readTestDeliveryMime(
  env: AppEnv,
  userId: string,
  captureId: string
) {
  const capture = await env.DB.prepare(
    "SELECT object_key FROM test_delivery_captures WHERE id=? AND user_id=?"
  )
    .bind(captureId, userId)
    .first<{ object_key: string }>();
  if (!capture) {
    throw new TestLabError("Test delivery capture was not found", 404);
  }
  const object = await env.DOCUMENTS.get(capture.object_key);
  if (!object?.body) {
    throw new TestLabError("Captured MIME data was not found", 404);
  }
  return object;
}

export async function createTestDeliveryEvent(
  db: D1Database,
  userId: string,
  captureId: string,
  input: {
    detail: string;
    eventType: "automated_reply" | "bounce" | "human_reply";
  }
) {
  const capture = await db
    .prepare("SELECT id FROM test_delivery_captures WHERE id=? AND user_id=?")
    .bind(captureId, userId)
    .first();
  if (!capture) {
    throw new TestLabError("Test delivery capture was not found", 404);
  }
  const event = {
    createdAt: new Date().toISOString(),
    id: crypto.randomUUID(),
    ...input,
  };
  await db
    .prepare(
      `INSERT INTO test_delivery_events
        (id,capture_id,user_id,event_type,detail,created_at)
       VALUES (?,?,?,?,?,?)`
    )
    .bind(
      event.id,
      captureId,
      userId,
      event.eventType,
      event.detail,
      event.createdAt
    )
    .run();
  return event;
}

async function requireAllowedRecipient(
  db: D1Database,
  userId: string,
  recipient: string
) {
  const allowed = await db
    .prepare(
      `SELECT email FROM test_delivery_allowlist
        WHERE user_id=? AND lower(email)=? LIMIT 1`
    )
    .bind(userId, recipient.trim().toLocaleLowerCase("en"))
    .first();
  if (!allowed) {
    throw new TestLabError(
      "Recipient is not on this account's explicit Test Lab allowlist",
      409
    );
  }
}

async function readDocuments(
  db: D1Database,
  userId: string,
  documentIds: string[]
) {
  if (documentIds.length === 0) {
    return [];
  }
  const placeholders = documentIds.map(() => "?").join(",");
  const rows = await db
    .prepare(
      `SELECT id,filename,object_key,content_type,size_bytes,r2_version,etag
         FROM user_documents
        WHERE user_id=? AND archived_at IS NULL AND id IN (${placeholders})`
    )
    .bind(userId, ...documentIds)
    .all<DocumentRow>();
  if (rows.results.length !== new Set(documentIds).size) {
    throw new TestLabError("One or more test attachments were not found", 404);
  }
  const documentsById = new Map(
    rows.results.map((document) => [document.id, document])
  );
  return documentIds.map((id) => documentsById.get(id)).filter(isDocumentRow);
}

function loadAttachments(bucket: R2Bucket, documents: DocumentRow[]) {
  return Promise.all(
    documents.map(async (document): Promise<MimeAttachment> => {
      const object = await bucket.get(document.object_key);
      if (!object) {
        throw new TestLabError(
          `Test attachment data was not found: ${document.filename}`,
          404
        );
      }
      if (
        object.version !== document.r2_version ||
        object.etag !== document.etag
      ) {
        throw new TestLabError(
          `Test attachment version changed: ${document.filename}`,
          409
        );
      }
      return {
        bytes: new Uint8Array(await object.arrayBuffer()),
        contentType: document.content_type,
        filename: document.filename,
      };
    })
  );
}

function isDocumentRow(value: DocumentRow | undefined): value is DocumentRow {
  return Boolean(value);
}
