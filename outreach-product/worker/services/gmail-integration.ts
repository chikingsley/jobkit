import type { AppEnv } from "../env";
import {
  claimEmailAttempt,
  type EmailAttemptView,
  prepareEmailSend,
  recordFailedEmailAttempt,
  recordGmailDraft,
  recordGmailSent,
  recordUncertainEmailAttempt,
  reserveGmailSend,
} from "./email-attempts";
import {
  createGmailDraft,
  getGmailMessage,
  getGmailProfile,
  sendGmailDraft,
  startGmailWatch,
} from "./gmail-api";
import {
  GMAIL_SCOPES,
  getGoogleAccessToken,
  gmailConfigurationIsAvailable,
} from "./gmail-auth";
import {
  asGmailIntegrationError,
  GmailIntegrationError,
  gmailErrorMessage,
} from "./gmail-errors";
import { markWatchError, reconcileRecentReplies } from "./gmail-replies";

interface GmailWatchRow {
  email_address: string;
  expiration_at: string;
  history_id: string;
  last_error: string;
  last_synced_at: string | null;
  status: "active" | "error" | "expired";
  user_id: string;
}

interface GoogleAccountRow {
  account_id: string;
  scope: string | null;
}

export interface GmailConnectionStatus {
  available: boolean;
  connected: boolean;
  emailAddress: string;
  missingScopes: string[];
  watch: null | {
    expirationAt: string;
    lastError: string;
    lastSyncedAt: string | null;
    status: GmailWatchRow["status"];
  };
}

export async function readGmailConnectionStatus(
  env: AppEnv,
  userId: string
): Promise<GmailConnectionStatus> {
  const [account, watch] = await Promise.all([
    env.DB.prepare(
      `SELECT account_id,scope FROM user_accounts
        WHERE user_id=? AND provider_id='google' LIMIT 1`
    )
      .bind(userId)
      .first<GoogleAccountRow>(),
    readWatchByUser(env.DB, userId),
  ]);
  const scopes = new Set(splitScopes(account?.scope ?? ""));
  const allMail = scopes.has("https://mail.google.com/");
  const missingScopes = GMAIL_SCOPES.filter(
    (scope) => !(allMail || scopes.has(scope))
  );
  return {
    available: gmailConfigurationIsAvailable(env),
    connected: Boolean(account && missingScopes.length === 0),
    emailAddress: watch?.email_address ?? "",
    missingScopes,
    watch: watch
      ? {
          expirationAt: watch.expiration_at,
          lastError: watch.last_error,
          lastSyncedAt: watch.last_synced_at,
          status: watch.status,
        }
      : null,
  };
}

export async function sendApplicationEmailWithGmail(
  env: AppEnv,
  userId: string,
  jobId: string,
  draftId: string,
  routeId: string
) {
  const status = await readGmailConnectionStatus(env, userId);
  if (status.watch?.status !== "active") {
    throw new GmailIntegrationError(
      "Finish Gmail setup in Messages before sending applications",
      { status: 409 }
    );
  }
  const accessToken = await getGoogleAccessToken(env, userId);
  const attempt = await prepareEmailSend(env, userId, jobId, draftId, routeId);
  const sent = await deliverEmailAttempt(env, userId, attempt, accessToken);
  return {
    attempt: sent,
    message: `Application sent to ${sent.recipient}`,
    ok: true as const,
  };
}

export async function deliverEmailAttempt(
  env: AppEnv,
  userId: string,
  initialAttempt: EmailAttemptView,
  accessToken: string
): Promise<EmailAttemptView> {
  let attempt = initialAttempt;
  if (attempt.status === "sent") {
    return attempt;
  }
  if (attempt.status === "approved") {
    attempt = await createAndRecordGmailDraft(
      env,
      userId,
      attempt,
      accessToken
    );
  }
  if (attempt.status !== "drafted") {
    throw new GmailIntegrationError(
      `Email attempt cannot be sent from ${attempt.status}`,
      { status: 409 }
    );
  }
  attempt = await reserveGmailSend(
    env.DB,
    userId,
    attempt.attemptId,
    attempt.gmailDraftId
  );
  const sent = await sendAndVerifyGmailDraft(env, userId, attempt, accessToken);
  return recordGmailSent(
    env.DB,
    userId,
    attempt.attemptId,
    attempt.gmailDraftId,
    sent.messageId,
    sent.threadId
  );
}

export async function startOrRenewGmailWatch(env: AppEnv, userId: string) {
  if (!env.GOOGLE_PUBSUB_TOPIC) {
    throw new GmailIntegrationError("Gmail reply sync is not configured yet", {
      status: 503,
    });
  }
  const accessToken = await getGoogleAccessToken(env, userId);
  const [profile, watchResult, existing] = await Promise.all([
    getGmailProfile(accessToken),
    startGmailWatch(accessToken, env.GOOGLE_PUBSUB_TOPIC),
    readWatchByUser(env.DB, userId),
  ]);
  const expirationAt = expirationIso(watchResult.expiration);
  const timestamp = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO gmail_mailbox_watches
      (user_id,email_address,history_id,expiration_at,status,last_synced_at,
       last_error,created_at,updated_at)
     VALUES (?,?,?,?,'active',NULL,'',?,?)
     ON CONFLICT(user_id) DO UPDATE SET
       email_address=excluded.email_address,
       history_id=gmail_mailbox_watches.history_id,
       expiration_at=excluded.expiration_at,status='active',last_error='',
       updated_at=excluded.updated_at`
  )
    .bind(
      userId,
      profile.emailAddress.toLowerCase(),
      watchResult.historyId,
      expirationAt,
      timestamp,
      timestamp
    )
    .run();

  const messagesRecorded = existing
    ? 0
    : await reconcileRecentReplies(
        env,
        userId,
        profile.emailAddress,
        accessToken
      );
  return {
    emailAddress: profile.emailAddress,
    expirationAt,
    messagesRecorded,
    ok: true as const,
  };
}

export async function renewExpiringGmailWatches(env: AppEnv) {
  const threshold = new Date(
    Date.now() + 2 * 24 * 60 * 60 * 1000
  ).toISOString();
  const rows = await env.DB.prepare(
    `SELECT user_id FROM gmail_mailbox_watches
      WHERE status<>'active' OR expiration_at<?`
  )
    .bind(threshold)
    .all<{ user_id: string }>();
  let renewed = 0;
  for (const row of rows.results) {
    try {
      await startOrRenewGmailWatch(env, row.user_id);
      renewed += 1;
    } catch (error) {
      await markWatchError(env.DB, row.user_id, gmailErrorMessage(error));
    }
  }
  return { renewed, total: rows.results.length };
}

async function createAndRecordGmailDraft(
  env: AppEnv,
  userId: string,
  attempt: EmailAttemptView,
  accessToken: string
) {
  const profile = await getGmailProfile(accessToken);
  const payload = await claimEmailAttempt(
    env,
    userId,
    attempt.attemptId,
    profile.emailAddress
  );
  try {
    const draft = await createGmailDraft(accessToken, payload.raw);
    if (!(draft.id && draft.message?.id)) {
      throw new GmailIntegrationError(
        "Gmail created a draft without returning its identifiers"
      );
    }
    return await recordGmailDraft(
      env.DB,
      userId,
      attempt.attemptId,
      draft.id,
      draft.message.id
    );
  } catch (error) {
    await recordPreSendFailure(env.DB, userId, attempt.attemptId, error);
    throw asGmailIntegrationError(error, "Gmail could not create the draft");
  }
}

async function sendAndVerifyGmailDraft(
  env: AppEnv,
  userId: string,
  attempt: EmailAttemptView,
  accessToken: string
) {
  let messageId = "";
  let threadId = "";
  try {
    const sent = await sendGmailDraft(accessToken, attempt.gmailDraftId);
    ({ id: messageId, threadId } = sent);
    if (!(messageId && threadId)) {
      throw new Error("Gmail send did not return message and thread IDs");
    }
    const verified = await getGmailMessage(accessToken, messageId, "metadata");
    if (
      verified.id !== messageId ||
      verified.threadId !== threadId ||
      !verified.labelIds?.includes("SENT")
    ) {
      throw new Error("Gmail could not verify the message with the SENT label");
    }
    return { messageId, threadId };
  } catch (error) {
    await recordUncertainEmailAttempt(
      env.DB,
      userId,
      attempt.attemptId,
      "gmail_send_or_verify",
      gmailErrorMessage(error),
      messageId,
      threadId
    );
    throw asGmailIntegrationError(
      error,
      "Gmail send was invoked but could not be verified"
    );
  }
}

async function recordPreSendFailure(
  db: D1Database,
  userId: string,
  attemptId: string,
  error: unknown
) {
  try {
    await recordFailedEmailAttempt(
      db,
      userId,
      attemptId,
      "gmail_draft_create",
      gmailErrorMessage(error)
    );
  } catch {
    // Preserve the original Gmail failure if state changed concurrently.
  }
}

function readWatchByUser(db: D1Database, userId: string) {
  return db
    .prepare("SELECT * FROM gmail_mailbox_watches WHERE user_id=?")
    .bind(userId)
    .first<GmailWatchRow>();
}

function expirationIso(expiration: string) {
  const value = Number(expiration);
  if (!(Number.isFinite(value) && value > Date.now())) {
    throw new GmailIntegrationError(
      "Gmail returned an invalid watch expiration"
    );
  }
  return new Date(value).toISOString();
}

function splitScopes(scope: string) {
  return scope.split(/[\s,]+/u).filter(Boolean);
}
