import type { AppEnv } from "../../../../worker/env";
import { jobEventStatement } from "../../../../worker/repositories/job-events";
import {
  acquireOutboundRecipientClaim,
  outboundRecipientDedupKey,
  releaseOutboundRecipientClaim,
} from "../../../../worker/repositories/outbound-recipient-claims";
import { applicationMessageOpeningProblem } from "../../04_compose/application-message-policy";
import {
  type AttemptSourceRow,
  EmailAttemptError,
  type EmailAttemptStatus,
  type EmailAttemptView,
} from "./model";
import {
  applicationSubject,
  readAttemptByBundleSelection,
  readAttemptBySelection,
  toAttemptView,
} from "./records";

export async function createApprovedEmailAttempt(
  env: AppEnv,
  userId: string,
  jobId: string,
  draftId: string,
  routeId: string
): Promise<EmailAttemptView> {
  const source = await env.DB.prepare(
    `SELECT uj.id user_job_id,uj.status job_status,
            d.id draft_id,d.status draft_status,d.message,d.required_opening,
            ar.id route_id,ar.kind route_kind,ar.destination recipient,
            ar.contact_channel_id,
            COALESCE(c.role,'unknown') contact_role,
            ar.status route_status,j.board,j.title,j.location,j.country,
            j.source_reference,u.email from_email
       FROM user_listing_states uj
       JOIN users u ON u.id=uj.user_id
       JOIN job_listings j ON j.id=uj.job_id
       JOIN application_drafts d ON d.user_job_id=uj.id
       JOIN application_routes ar ON ar.job_id=j.id
       LEFT JOIN contact_channels cc ON cc.id=ar.contact_channel_id
       LEFT JOIN contacts c ON c.id=cc.contact_id
      WHERE uj.user_id=? AND j.id=? AND d.id=? AND ar.id=?
        AND d.id=(
          SELECT id FROM application_drafts
          WHERE user_job_id=uj.id ORDER BY version DESC LIMIT 1
        )`
  )
    .bind(userId, jobId, draftId, routeId)
    .first<AttemptSourceRow>();
  if (!source) {
    throw new EmailAttemptError(
      "The selected job, draft, or application route is no longer current",
      404
    );
  }
  if (source.route_kind !== "email" || source.route_status !== "active") {
    throw new EmailAttemptError("The selected email route is not active", 409);
  }
  if (
    !new Set(["new", "review", "approved", "failed"]).has(source.job_status)
  ) {
    throw new EmailAttemptError("The job is not ready for email approval", 409);
  }
  if (!new Set(["draft", "approved"]).has(source.draft_status)) {
    throw new EmailAttemptError("The selected draft is not approvable", 409);
  }
  await assertNoExistingContactAttempt(env.DB, userId, source);
  const messagePolicyProblem = applicationMessageOpeningProblem(
    source.message,
    source.required_opening
  );
  if (messagePolicyProblem) {
    throw new EmailAttemptError(messagePolicyProblem, 422);
  }

  const timestamp = new Date().toISOString();
  const existingAttempt = await readAttemptBySelection(
    env.DB,
    userId,
    source.user_job_id,
    draftId,
    routeId
  );
  const attemptId = existingAttempt?.id ?? crypto.randomUUID();
  const subject = applicationSubject(
    source.board,
    source.source_reference,
    source.title,
    source.location,
    source.country
  );
  await acquireApplicationRecipientClaim(env.DB, userId, source, attemptId);
  let results: D1Result<unknown>[];
  try {
    results = await env.DB.batch([
      env.DB.prepare(
        `UPDATE user_listing_states
          SET status='approved',updated_at=?
        WHERE id=? AND user_id=? AND status IN ('new','review','approved','failed')`
      ).bind(timestamp, source.user_job_id, userId),
      env.DB.prepare(
        `UPDATE application_drafts
          SET status='approved',approved_at=COALESCE(approved_at,?)
        WHERE id=? AND status IN ('draft','approved')`
      ).bind(timestamp, draftId),
      env.DB.prepare(
        `INSERT INTO application_attempts
        (id,user_job_id,draft_id,route_id,channel,recipient,subject,status,
         approved_at,created_at,updated_at)
       VALUES (?,?,?,?,'email',?,?,'approved',?,?,?)
       ON CONFLICT(user_job_id,draft_id,route_id) DO UPDATE SET
         status='approved',payload_sha256='',claimed_at=NULL,
         error_stage='',error_detail='',approved_at=excluded.approved_at,
         updated_at=excluded.updated_at
       WHERE application_attempts.status='failed'`
      ).bind(
        attemptId,
        source.user_job_id,
        draftId,
        routeId,
        source.recipient,
        subject,
        timestamp,
        timestamp,
        timestamp
      ),
    ]);
  } catch (error) {
    await releaseOutboundRecipientClaim(
      env.DB,
      "application_attempt",
      attemptId
    );
    throw error;
  }
  if ((results.at(2)?.meta.changes ?? 0) === 1) {
    await env.DB.batch([
      jobEventStatement(
        env.DB,
        source.user_job_id,
        "email_approved",
        `Approved email to ${source.recipient}`,
        draftId
      ),
    ]);
  }
  const row = await readAttemptBySelection(
    env.DB,
    userId,
    source.user_job_id,
    draftId,
    routeId
  );
  if (!row) {
    throw new Error("Approved email attempt could not be read back");
  }
  return toAttemptView(row);
}

async function assertNoExistingContactAttempt(
  db: D1Database,
  userId: string,
  source: AttemptSourceRow
) {
  const existing = await db
    .prepare(
      `SELECT a.status,j.title
       FROM application_attempts a
       JOIN user_listing_states uj ON uj.id=a.user_job_id
       JOIN job_listings j ON j.id=uj.job_id
       JOIN application_routes previous_route ON previous_route.id=a.route_id
       WHERE uj.user_id=?
         AND COALESCE(
           previous_route.contact_channel_id,
           'email:' || lower(trim(a.recipient))
         )=COALESCE(?, 'email:' || lower(trim(?)))
         AND a.status IN (
           'approved','claimed','drafted','sending','sent','uncertain'
         )
         AND (a.status<>'sent' OR ?<>'board_intermediary')
         AND NOT (
           a.user_job_id=? AND a.draft_id=? AND a.route_id=?
         )
       ORDER BY a.created_at DESC
       LIMIT 1`
    )
    .bind(
      userId,
      source.contact_channel_id,
      source.recipient,
      source.contact_role,
      source.user_job_id,
      source.draft_id,
      source.route_id
    )
    .first<{ status: EmailAttemptStatus; title: string }>();
  if (!existing) {
    return;
  }
  throw new EmailAttemptError(
    `This contact already has an application for “${existing.title}” (${existing.status}). Review that thread instead of starting another email.`,
    409
  );
}

async function acquireApplicationRecipientClaim(
  db: D1Database,
  userId: string,
  source: AttemptSourceRow,
  attemptId: string
) {
  await acquireOutboundRecipientClaim(db, {
    dedupKey: outboundRecipientDedupKey(
      source.contact_channel_id,
      source.recipient
    ),
    sourceId: attemptId,
    sourceKind: "application_attempt",
    userId,
  });
}

export async function createApprovedBundleEmailAttempt(
  env: AppEnv,
  userId: string,
  bundleId: string,
  draftId: string
): Promise<EmailAttemptView> {
  const source = await env.DB.prepare(
    `SELECT uj.id user_job_id,uj.status job_status,
            d.id draft_id,d.status draft_status,d.message,d.required_opening,
            ar.id route_id,ar.kind route_kind,ar.destination recipient,
            ar.contact_channel_id,COALESCE(c.role,'unknown') contact_role,
            ar.status route_status,j.board,j.title,j.location,j.country,
            j.source_reference,u.email from_email,b.status bundle_status,
            b.subject
       FROM application_bundles b
       JOIN application_bundle_targets bt
         ON bt.bundle_id=b.id AND bt.ordinal=0
       JOIN user_listing_states uj ON uj.id=bt.user_job_id
       JOIN users u ON u.id=uj.user_id
       JOIN job_listings j ON j.id=uj.job_id
       JOIN application_routes ar ON ar.id=bt.route_id
       JOIN application_drafts d ON d.application_bundle_id=b.id
       LEFT JOIN contact_channels cc ON cc.id=ar.contact_channel_id
       LEFT JOIN contacts c ON c.id=cc.contact_id
      WHERE b.id=? AND b.user_id=? AND d.id=?
        AND d.id=(
          SELECT id FROM application_drafts
           WHERE application_bundle_id=b.id ORDER BY version DESC LIMIT 1
        )`
  )
    .bind(bundleId, userId, draftId)
    .first<AttemptSourceRow & { bundle_status: string; subject: string }>();
  if (!source) {
    throw new EmailAttemptError(
      "The application set or its draft is no longer current",
      404
    );
  }
  if (source.route_kind !== "email" || source.route_status !== "active") {
    throw new EmailAttemptError("The ANESL email route is not active", 409);
  }
  if (!new Set(["review", "approved", "failed"]).has(source.bundle_status)) {
    throw new EmailAttemptError(
      "The application set is not ready for approval",
      409
    );
  }
  if (!new Set(["draft", "approved"]).has(source.draft_status)) {
    throw new EmailAttemptError("The selected draft is not approvable", 409);
  }
  await assertNoExistingContactAttempt(env.DB, userId, source);
  const messagePolicyProblem = applicationMessageOpeningProblem(
    source.message,
    source.required_opening
  );
  if (messagePolicyProblem) {
    throw new EmailAttemptError(messagePolicyProblem, 422);
  }

  const timestamp = new Date().toISOString();
  const existingAttempt = await readAttemptByBundleSelection(
    env.DB,
    userId,
    bundleId,
    draftId
  );
  const attemptId = existingAttempt?.id ?? crypto.randomUUID();
  await acquireApplicationRecipientClaim(env.DB, userId, source, attemptId);
  let results: D1Result<unknown>[];
  try {
    results = await env.DB.batch([
      env.DB.prepare(
        `UPDATE user_listing_states SET status='approved',updated_at=?
        WHERE user_id=? AND id IN (
          SELECT user_job_id FROM application_bundle_targets WHERE bundle_id=?
        ) AND status IN ('new','review','approved','failed')`
      ).bind(timestamp, userId, bundleId),
      env.DB.prepare(
        `UPDATE application_drafts
          SET status='approved',approved_at=COALESCE(approved_at,?)
        WHERE id=? AND application_bundle_id=? AND status IN ('draft','approved')`
      ).bind(timestamp, draftId, bundleId),
      env.DB.prepare(
        `UPDATE application_bundles SET status='approved',updated_at=?
        WHERE id=? AND user_id=? AND status IN ('review','approved','failed')`
      ).bind(timestamp, bundleId, userId),
      env.DB.prepare(
        `INSERT INTO application_attempts
        (id,user_job_id,draft_id,route_id,application_bundle_id,channel,
         recipient,subject,status,approved_at,created_at,updated_at)
       VALUES (?,?,?,?,?,'email',?,?,'approved',?,?,?)
       ON CONFLICT(user_job_id,draft_id,route_id) DO UPDATE SET
         application_bundle_id=excluded.application_bundle_id,status='approved',
         payload_sha256='',claimed_at=NULL,error_stage='',error_detail='',
         approved_at=excluded.approved_at,updated_at=excluded.updated_at
       WHERE application_attempts.status='failed'`
      ).bind(
        attemptId,
        source.user_job_id,
        draftId,
        source.route_id,
        bundleId,
        source.recipient,
        source.subject,
        timestamp,
        timestamp,
        timestamp
      ),
    ]);
  } catch (error) {
    await releaseOutboundRecipientClaim(
      env.DB,
      "application_attempt",
      attemptId
    );
    throw error;
  }
  if ((results.at(3)?.meta.changes ?? 0) !== 1) {
    throw new EmailAttemptError(
      "The application set already has an active email attempt",
      409
    );
  }
  const row = await readAttemptByBundleSelection(
    env.DB,
    userId,
    bundleId,
    draftId
  );
  if (!row) {
    throw new Error("Approved bundle email attempt could not be read back");
  }
  return toAttemptView(row);
}
