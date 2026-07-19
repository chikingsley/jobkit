import type { AppEnv } from "../env";
import {
  createGmailDraft,
  getGmailMessage,
  getGmailProfile,
  sendGmailDraft,
} from "./gmail-api";
import { getGoogleAccessToken } from "./gmail-auth";
import {
  asGmailIntegrationError,
  GmailIntegrationError,
  gmailErrorMessage,
} from "./gmail-errors";
import { readGmailConnectionStatus } from "./gmail-integration";
import { buildGmailMessagePayload } from "./gmail-message";

interface TestSendRow {
  draft_id: string;
  id: string;
  recipient: string;
  status: string;
  subject: string;
}

export async function sendApplicationBundleTestEmail(
  env: AppEnv,
  userId: string,
  bundleId: string,
  recipient: string
) {
  const connection = await readGmailConnectionStatus(env, userId);
  if (connection.watch?.status !== "active") {
    throw new GmailIntegrationError(
      "Finish Gmail setup in Messages before sending a test",
      { status: 409 }
    );
  }
  const source = await env.DB.prepare(
    `SELECT b.subject,b.status,d.id draft_id
       FROM application_bundles b
       JOIN application_drafts d ON d.application_bundle_id=b.id
      WHERE b.id=? AND b.user_id=? AND b.kind='anesl_positions'
        AND b.status IN ('review','approved','failed')
        AND d.id=(
          SELECT latest.id FROM application_drafts latest
           WHERE latest.application_bundle_id=b.id
           ORDER BY latest.version DESC LIMIT 1
        )`
  )
    .bind(bundleId, userId)
    .first<{ draft_id: string; status: string; subject: string }>();
  if (!source) {
    throw new GmailIntegrationError(
      "The ANESL application set is not available for a test send",
      { status: 409 }
    );
  }
  const subject = `[TEST] ${source.subject}`.slice(0, 180);
  const timestamp = new Date().toISOString();
  const testSendId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO application_bundle_test_sends
      (id,bundle_id,draft_id,recipient,subject,status,created_at,updated_at)
     VALUES (?,?,?,?,?,'approved',?,?)
     ON CONFLICT(bundle_id,draft_id,recipient) DO UPDATE SET
       status=CASE
         WHEN application_bundle_test_sends.status='sent' THEN 'sent'
         ELSE 'approved'
       END,
       error_detail=CASE
         WHEN application_bundle_test_sends.status='sent'
         THEN application_bundle_test_sends.error_detail ELSE '' END,
       updated_at=excluded.updated_at`
  )
    .bind(
      testSendId,
      bundleId,
      source.draft_id,
      recipient,
      subject,
      timestamp,
      timestamp
    )
    .run();
  const testSend = await readTestSend(
    env.DB,
    userId,
    bundleId,
    source.draft_id,
    recipient
  );
  if (testSend.status === "sent") {
    return testSendResult(testSend);
  }

  const accessToken = await getGoogleAccessToken(env, userId);
  const profile = await getGmailProfile(accessToken);
  let sendReserved = false;
  try {
    const payload = await buildGmailMessagePayload(
      env,
      userId,
      source.draft_id,
      {
        from: profile.emailAddress,
        subject,
        to: recipient,
      }
    );
    await env.DB.prepare(
      `UPDATE application_bundle_test_sends
          SET status='claimed',payload_sha256=?,updated_at=?
        WHERE id=? AND status='approved'`
    )
      .bind(await sha256(payload.raw), new Date().toISOString(), testSend.id)
      .run();
    const draft = await createGmailDraft(accessToken, payload.raw);
    if (!draft.id) {
      throw new Error("Gmail created a test draft without an identifier");
    }
    await env.DB.prepare(
      `UPDATE application_bundle_test_sends
          SET status='drafted',gmail_draft_id=?,updated_at=?
        WHERE id=? AND status='claimed'`
    )
      .bind(draft.id, new Date().toISOString(), testSend.id)
      .run();
    const reserved = await env.DB.prepare(
      `UPDATE application_bundle_test_sends SET status='sending',updated_at=?
        WHERE id=? AND status='drafted' AND gmail_draft_id=?`
    )
      .bind(new Date().toISOString(), testSend.id, draft.id)
      .run();
    if ((reserved.meta.changes ?? 0) !== 1) {
      throw new Error("Test email send state changed concurrently");
    }
    sendReserved = true;
    const sent = await sendGmailDraft(accessToken, draft.id);
    if (!(sent.id && sent.threadId)) {
      throw new Error("Gmail test send did not return message identifiers");
    }
    const verified = await getGmailMessage(accessToken, sent.id, "metadata");
    if (
      verified.id !== sent.id ||
      verified.threadId !== sent.threadId ||
      !verified.labelIds?.includes("SENT")
    ) {
      throw new Error(
        "Gmail could not verify the test email with the SENT label"
      );
    }
    const sentAt = new Date().toISOString();
    await env.DB.prepare(
      `UPDATE application_bundle_test_sends
          SET status='sent',gmail_message_id=?,gmail_thread_id=?,sent_at=?,
              updated_at=?
        WHERE id=? AND status='sending'`
    )
      .bind(sent.id, sent.threadId, sentAt, sentAt, testSend.id)
      .run();
    return testSendResult(
      await readTestSend(env.DB, userId, bundleId, source.draft_id, recipient)
    );
  } catch (error) {
    const status = sendReserved ? "uncertain" : "failed";
    await env.DB.prepare(
      `UPDATE application_bundle_test_sends
          SET status=?,error_detail=?,updated_at=?
        WHERE id=? AND status<>'sent'`
    )
      .bind(
        status,
        gmailErrorMessage(error).slice(0, 1000),
        new Date().toISOString(),
        testSend.id
      )
      .run();
    throw asGmailIntegrationError(
      error,
      sendReserved
        ? "The Gmail test send was invoked but could not be verified"
        : "Gmail could not create the test email"
    );
  }
}

async function readTestSend(
  db: D1Database,
  userId: string,
  bundleId: string,
  draftId: string,
  recipient: string
) {
  const row = await db
    .prepare(
      `SELECT ts.id,ts.draft_id,ts.recipient,ts.subject,ts.status
       FROM application_bundle_test_sends ts
       JOIN application_bundles b ON b.id=ts.bundle_id
      WHERE b.user_id=? AND ts.bundle_id=? AND ts.draft_id=? AND ts.recipient=?`
    )
    .bind(userId, bundleId, draftId, recipient)
    .first<TestSendRow>();
  if (!row) {
    throw new Error("Bundle test email could not be read back");
  }
  return row;
}

function testSendResult(row: TestSendRow) {
  return {
    message: `Test application sent to ${row.recipient}`,
    ok: true as const,
    testSend: {
      id: row.id,
      recipient: row.recipient,
      status: row.status,
      subject: row.subject,
    },
  };
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}
