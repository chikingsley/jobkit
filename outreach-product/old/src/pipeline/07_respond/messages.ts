import type {
  MessageThreadDetail,
  MessageThreadSummary,
} from "../../features/messages/types";
import { listThreadFollowUps } from "./followups";
import { loadThreadAttachments } from "./messages/attachments";
import { readThreadOutcome } from "./messages/inbound";
import {
  toInboundThreadMessage,
  toThreadMessage,
  toThreadSummary,
} from "./messages/mapping";
import {
  ATTEMPT_THREAD_PREFIX,
  type BundleTargetRow,
  CAMPAIGN_ATTEMPT_THREAD_PREFIX,
  type InboundMessageRow,
  MessageThreadError,
  THREAD_STATUSES,
  type ThreadMessageRow,
  type ThreadSummaryRow,
} from "./messages/model";

// biome-ignore lint/performance/noBarrelFile: This behavior-owning module preserves its stable public API after internal decomposition.
export { getThreadAttachment } from "./messages/attachments";
export {
  markThreadRead,
  recordInboundMessage,
  writeThreadOutcome,
} from "./messages/inbound";
export type {
  InboundMessageInput,
  MessageThreadOutcome,
} from "./messages/model";
export { MessageThreadError } from "./messages/model";

export async function listMessageThreads(
  db: D1Database,
  userId: string
): Promise<MessageThreadSummary[]> {
  const placeholders = THREAD_STATUSES.map((_, i) => `?${i + 2}`).join(",");
  const [applications, campaigns] = await Promise.all([
    db
      .prepare(
        `SELECT a.id,a.application_bundle_id,a.gmail_thread_id,a.recipient,
              a.subject,a.status,'application' source_kind,
              a.sent_at,a.updated_at,a.created_at,
              uj.job_id,j.title,j.company,j.country,j.location,d.message,
              CASE WHEN a.application_bundle_id IS NULL THEN 1 ELSE (
                SELECT COUNT(*) FROM application_bundle_targets bt
                 WHERE bt.bundle_id=a.application_bundle_id
              ) END target_count,
              CASE WHEN a.application_bundle_id IS NULL THEN '[]' ELSE (
                SELECT json_group_array(bt.source_reference)
                  FROM application_bundle_targets bt
                 WHERE bt.bundle_id=a.application_bundle_id
                 ORDER BY bt.ordinal
              ) END target_references_json,
              (SELECT COUNT(*) FROM application_draft_attachments att
                WHERE att.draft_id=a.draft_id) attachment_count,
              COALESCE(tm.inbound_count,0) inbound_count,
              COALESCE(tm.unread_count,0) unread_count,
              COALESCE(tm.last_inbound_at,'') last_inbound_at,
              COALESCE(tm.last_inbound_body,'') last_inbound_body
         FROM application_attempts a
         JOIN user_listing_states uj ON uj.id=a.user_job_id
         JOIN job_listings j ON j.id=uj.job_id
         JOIN application_drafts d ON d.id=a.draft_id
         LEFT JOIN (
           SELECT t1.gmail_thread_id,
                  COUNT(*) inbound_count,
                  SUM(CASE WHEN t1.read_at IS NULL THEN 1 ELSE 0 END) unread_count,
                  MAX(t1.sent_at) last_inbound_at,
                  (SELECT t2.body_text FROM application_thread_messages t2
                    WHERE t2.user_id=t1.user_id
                      AND t2.gmail_thread_id=t1.gmail_thread_id
                    ORDER BY t2.sent_at DESC LIMIT 1) last_inbound_body
             FROM application_thread_messages t1
            WHERE t1.user_id=?1
            GROUP BY t1.gmail_thread_id
         ) tm ON a.gmail_thread_id<>'' AND tm.gmail_thread_id=a.gmail_thread_id
        WHERE uj.user_id=?1 AND a.channel='email'
          AND a.status IN (${placeholders})
        ORDER BY MAX(COALESCE(NULLIF(a.sent_at,''),a.updated_at),
                     COALESCE(tm.last_inbound_at,'')) DESC,
                 a.created_at DESC`
      )
      .bind(userId, ...THREAD_STATUSES)
      .all<ThreadSummaryRow>(),
    db
      .prepare(
        `SELECT a.id,NULL application_bundle_id,a.gmail_thread_id,a.recipient,
                a.subject,a.status,'campaign' source_kind,
                a.sent_at,a.updated_at,a.created_at,
                COALESCE(first_job.id,'') job_id,
                c.name title,
                COALESCE(first_job.company,first_organization.name,c.name) company,
                market.country_name country,
                COALESCE(first_job.location,first_organization.city,'') location,
                message.message,
                (SELECT COUNT(*) FROM campaign_dispatch_targets count_target
                  WHERE count_target.dispatch_id=d.id) target_count,
                COALESCE((
                  SELECT json_group_array(
                    COALESCE(target_job.source_reference,target_org.name)
                  )
                    FROM campaign_dispatch_targets refs
                    JOIN campaign_targets target ON target.id=refs.target_id
                    LEFT JOIN job_listings target_job ON target_job.id=target.job_id
                    LEFT JOIN organizations target_org
                      ON target_org.id=target.organization_id
                   WHERE refs.dispatch_id=d.id ORDER BY refs.ordinal
                ),'[]') target_references_json,
                (SELECT COUNT(*) FROM campaign_dispatch_attachments att
                  WHERE att.dispatch_id=d.id) attachment_count,
                COALESCE(tm.inbound_count,0) inbound_count,
                COALESCE(tm.unread_count,0) unread_count,
                COALESCE(tm.last_inbound_at,'') last_inbound_at,
                COALESCE(tm.last_inbound_body,'') last_inbound_body
           FROM campaign_email_attempts a
           JOIN campaign_dispatches d ON d.id=a.dispatch_id
           JOIN campaigns c ON c.id=d.campaign_id
           JOIN campaign_dispatch_targets first_dispatch_target
             ON first_dispatch_target.dispatch_id=d.id
            AND first_dispatch_target.ordinal=0
           JOIN campaign_targets first_target
             ON first_target.id=first_dispatch_target.target_id
           JOIN campaign_markets market
             ON market.campaign_id=c.id
            AND market.country_code=first_target.country_code
           LEFT JOIN job_listings first_job ON first_job.id=first_target.job_id
           LEFT JOIN organizations first_organization
             ON first_organization.id=first_target.organization_id
           JOIN campaign_messages message ON message.dispatch_id=d.id
            AND message.status='sent'
           LEFT JOIN (
             SELECT t1.gmail_thread_id,
                    COUNT(*) inbound_count,
                    SUM(CASE WHEN t1.read_at IS NULL THEN 1 ELSE 0 END)
                      unread_count,
                    MAX(t1.sent_at) last_inbound_at,
                    (SELECT t2.body_text FROM application_thread_messages t2
                      WHERE t2.user_id=t1.user_id
                        AND t2.gmail_thread_id=t1.gmail_thread_id
                      ORDER BY t2.sent_at DESC LIMIT 1) last_inbound_body
               FROM application_thread_messages t1
              WHERE t1.user_id=?1
              GROUP BY t1.gmail_thread_id
           ) tm ON a.gmail_thread_id<>''
               AND tm.gmail_thread_id=a.gmail_thread_id
          WHERE c.user_id=?1 AND a.status IN (${placeholders})
            AND message.version=(
              SELECT MAX(latest.version) FROM campaign_messages latest
               WHERE latest.dispatch_id=d.id AND latest.status='sent'
            )
          ORDER BY MAX(COALESCE(NULLIF(a.sent_at,''),a.updated_at),
                       COALESCE(tm.last_inbound_at,'')) DESC,
                   a.created_at DESC`
      )
      .bind(userId, ...THREAD_STATUSES)
      .all<ThreadSummaryRow>(),
  ]);
  return [...applications.results, ...campaigns.results]
    .map(toThreadSummary)
    .sort((left, right) =>
      right.lastActivityAt.localeCompare(left.lastActivityAt)
    );
}

export async function getMessageThread(
  db: D1Database,
  userId: string,
  threadId: string
): Promise<MessageThreadDetail> {
  const campaignAttemptKey = threadId.startsWith(CAMPAIGN_ATTEMPT_THREAD_PREFIX)
    ? threadId.slice(CAMPAIGN_ATTEMPT_THREAD_PREFIX.length)
    : "";
  const attemptKey = threadId.startsWith(ATTEMPT_THREAD_PREFIX)
    ? threadId.slice(ATTEMPT_THREAD_PREFIX.length)
    : "";
  const gmailThreadKey = attemptKey || campaignAttemptKey ? "" : threadId;
  const rows = campaignAttemptKey
    ? { results: [] as ThreadMessageRow[] }
    : await db
        .prepare(
          `SELECT a.id,a.application_bundle_id,a.draft_id,a.recipient,a.subject,
                  a.status,a.sent_at,a.updated_at,a.created_at,
                  a.gmail_message_id,a.gmail_thread_id,a.error_stage,
                  a.error_detail,d.message,u.email from_email,uj.job_id,
                  j.title,j.company
             FROM application_attempts a
             JOIN user_listing_states uj ON uj.id=a.user_job_id
             JOIN users u ON u.id=uj.user_id
             JOIN job_listings j ON j.id=uj.job_id
             JOIN application_drafts d ON d.id=a.draft_id
            WHERE uj.user_id=? AND a.channel='email'
              AND ((?<>'' AND a.id=?) OR (?<>'' AND a.gmail_thread_id=?))
            ORDER BY a.created_at ASC`
        )
        .bind(userId, attemptKey, attemptKey, gmailThreadKey, gmailThreadKey)
        .all<ThreadMessageRow>();
  const [first] = rows.results;
  if (!first) {
    return getCampaignMessageThread(
      db,
      userId,
      threadId,
      campaignAttemptKey,
      gmailThreadKey
    );
  }
  const attachments = await loadThreadAttachments(
    db,
    userId,
    rows.results.map((row) => row.id)
  );
  const inbound = first.gmail_thread_id
    ? await db
        .prepare(
          `SELECT id,gmail_message_id,direction,from_address,to_address,
                  subject,body_text,sent_at,classification
             FROM application_thread_messages
            WHERE user_id=? AND gmail_thread_id=?
            ORDER BY sent_at ASC`
        )
        .bind(userId, first.gmail_thread_id)
        .all<InboundMessageRow>()
    : { results: [] as InboundMessageRow[] };
  const messages = [
    ...rows.results.map((row) =>
      toThreadMessage(row, attachments.get(row.id) ?? [])
    ),
    ...inbound.results.map(toInboundThreadMessage),
  ].sort((a, b) => a.sentAt.localeCompare(b.sentAt));
  const applicationTargets = first.application_bundle_id
    ? await loadBundleTargets(db, first.application_bundle_id)
    : [];
  return {
    applicationTargets,
    company: applicationTargets.length > 0 ? "ANESL" : first.company,
    followUps: await listThreadFollowUps(db, userId, first.gmail_thread_id),
    gmailThreadId: first.gmail_thread_id,
    jobId: first.job_id,
    messages,
    outcome: await readThreadOutcome(db, userId, first.gmail_thread_id),
    recipient: first.recipient,
    subject: first.subject,
    threadId,
    title:
      applicationTargets.length > 0
        ? `${applicationTargets.length} ANESL positions`
        : first.title,
  };
}

async function getCampaignMessageThread(
  db: D1Database,
  userId: string,
  threadId: string,
  attemptKey: string,
  gmailThreadKey: string
): Promise<MessageThreadDetail> {
  const rows = await db
    .prepare(
      `SELECT a.id,NULL application_bundle_id,'' draft_id,a.recipient,a.subject,
              a.status,a.sent_at,a.updated_at,a.created_at,
              a.gmail_message_id,a.gmail_thread_id,a.error_stage,a.error_detail,
              message.message,u.email from_email,
              COALESCE(first_job.id,'') job_id,c.name title,
              COALESCE(first_job.company,first_organization.name,c.name) company
         FROM campaign_email_attempts a
         JOIN campaign_dispatches d ON d.id=a.dispatch_id
         JOIN campaigns c ON c.id=d.campaign_id
         JOIN users u ON u.id=c.user_id
         JOIN campaign_messages message ON message.dispatch_id=d.id
         JOIN campaign_dispatch_targets first_dispatch_target
           ON first_dispatch_target.dispatch_id=d.id
          AND first_dispatch_target.ordinal=0
         JOIN campaign_targets first_target
           ON first_target.id=first_dispatch_target.target_id
         LEFT JOIN job_listings first_job ON first_job.id=first_target.job_id
         LEFT JOIN organizations first_organization
           ON first_organization.id=first_target.organization_id
        WHERE c.user_id=?
          AND ((?<>'' AND a.id=?) OR (?<>'' AND a.gmail_thread_id=?))
          AND message.status='sent'
          AND message.version=(
            SELECT MAX(latest.version) FROM campaign_messages latest
             WHERE latest.dispatch_id=d.id AND latest.status='sent'
          )
        ORDER BY a.created_at`
    )
    .bind(userId, attemptKey, attemptKey, gmailThreadKey, gmailThreadKey)
    .all<ThreadMessageRow>();
  const [first] = rows.results;
  if (!first) {
    throw new MessageThreadError("Message thread not found");
  }
  const attachments = await loadThreadAttachments(
    db,
    userId,
    rows.results.map((row) => row.id)
  );
  const inbound = first.gmail_thread_id
    ? await db
        .prepare(
          `SELECT id,gmail_message_id,direction,from_address,to_address,
                  subject,body_text,sent_at,classification
             FROM application_thread_messages
            WHERE user_id=? AND gmail_thread_id=?
            ORDER BY sent_at ASC`
        )
        .bind(userId, first.gmail_thread_id)
        .all<InboundMessageRow>()
    : { results: [] as InboundMessageRow[] };
  const messages = [
    ...rows.results.map((row) =>
      toThreadMessage(row, attachments.get(row.id) ?? [])
    ),
    ...inbound.results.map(toInboundThreadMessage),
  ].sort((left, right) => left.sentAt.localeCompare(right.sentAt));
  return {
    applicationTargets: await loadCampaignTargets(db, first.id),
    company: first.company,
    followUps: await listThreadFollowUps(db, userId, first.gmail_thread_id),
    gmailThreadId: first.gmail_thread_id,
    jobId: first.job_id,
    messages,
    outcome: await readThreadOutcome(db, userId, first.gmail_thread_id),
    recipient: first.recipient,
    subject: first.subject,
    threadId,
    title: first.title,
  };
}

async function loadCampaignTargets(db: D1Database, attemptId: string) {
  const rows = await db
    .prepare(
      `SELECT COALESCE(j.id,o.id) job_id,
              COALESCE(j.source_reference,o.name) source_reference,
              COALESCE(j.title,o.name) title,
              COALESCE(j.location,o.city,'') location
         FROM campaign_email_attempts attempt
         JOIN campaign_dispatch_targets dispatch_target
           ON dispatch_target.dispatch_id=attempt.dispatch_id
         JOIN campaign_targets target ON target.id=dispatch_target.target_id
         LEFT JOIN job_listings j ON j.id=target.job_id
         LEFT JOIN organizations o ON o.id=target.organization_id
        WHERE attempt.id=? ORDER BY dispatch_target.ordinal`
    )
    .bind(attemptId)
    .all<BundleTargetRow>();
  return rows.results.map((row) => ({
    jobId: row.job_id,
    location: row.location,
    sourceReference: row.source_reference,
    title: row.title,
  }));
}

async function loadBundleTargets(db: D1Database, bundleId: string) {
  const rows = await db
    .prepare(
      `SELECT uj.job_id,bt.source_reference,bt.title,bt.location
         FROM application_bundle_targets bt
         JOIN user_listing_states uj ON uj.id=bt.user_job_id
        WHERE bt.bundle_id=? ORDER BY bt.ordinal`
    )
    .bind(bundleId)
    .all<BundleTargetRow>();
  return rows.results.map((row) => ({
    jobId: row.job_id,
    location: row.location,
    sourceReference: row.source_reference,
    title: row.title,
  }));
}
