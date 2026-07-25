import { APPLICATION_MESSAGE_TASK_TYPE } from "../../../src/agent-tasks/application-message";
import type { ApplicationMessageRoute } from "../../schemas";
import { buildAgentTaskRequestCreation } from "../agent-task-requests";
import {
  type FollowUpCandidateRow,
  FollowUpError,
  type FollowUpSourceRow,
  type FollowUpView,
  type LatestFollowUpRow,
} from "./model";

export async function followUpCandidates(db: D1Database) {
  const rows = await db
    .prepare(
      `SELECT source_kind,source_attempt_id,user_id,gmail_thread_id,sent_at
         FROM (
          SELECT 'application' source_kind,a.id source_attempt_id,uj.user_id,
                 a.gmail_thread_id,a.sent_at
            FROM application_attempts a
            JOIN user_listing_states uj ON uj.id=a.user_job_id
            JOIN user_automation_policies policy ON policy.user_id=uj.user_id
           WHERE a.status='sent' AND a.gmail_thread_id<>''
             AND policy.follow_up_delays_json<>'[]' AND policy.paused=0
          UNION ALL
          SELECT 'campaign' source_kind,a.id source_attempt_id,c.user_id,
                 a.gmail_thread_id,a.sent_at
            FROM campaign_email_attempts a
            JOIN campaign_dispatches dispatch ON dispatch.id=a.dispatch_id
            JOIN campaigns c ON c.id=dispatch.campaign_id
            JOIN user_automation_policies policy ON policy.user_id=c.user_id
           WHERE a.status='sent' AND a.gmail_thread_id<>''
             AND policy.follow_up_delays_json<>'[]' AND policy.paused=0
         ) sent
        WHERE NOT EXISTS (
          SELECT 1 FROM application_thread_messages reply
           WHERE reply.user_id=sent.user_id
             AND reply.gmail_thread_id=sent.gmail_thread_id
             AND reply.direction='inbound'
             AND reply.classification IN ('human','bounce')
        )
        ORDER BY sent_at,source_attempt_id`
    )
    .all<FollowUpCandidateRow>();
  return rows.results;
}

export async function queueDueCandidate(
  db: D1Database,
  candidate: FollowUpCandidateRow,
  now: Date
) {
  const [policy, latest] = await Promise.all([
    db
      .prepare(
        "SELECT follow_up_delays_json FROM user_automation_policies WHERE user_id=?"
      )
      .bind(candidate.user_id)
      .first<{ follow_up_delays_json: string }>(),
    db
      .prepare(
        `SELECT ordinal,status,sent_at FROM outreach_followups
          WHERE user_id=? AND gmail_thread_id=?
          ORDER BY ordinal DESC LIMIT 1`
      )
      .bind(candidate.user_id, candidate.gmail_thread_id)
      .first<LatestFollowUpRow>(),
  ]);
  const delays = policy
    ? (JSON.parse(policy.follow_up_delays_json) as unknown)
    : [];
  if (!Array.isArray(delays)) {
    return false;
  }
  if (latest && latest.status !== "sent") {
    return false;
  }
  const ordinal = (latest?.ordinal ?? 0) + 1;
  const delay = Number(delays[ordinal - 1]);
  const baseAt = latest?.sent_at ?? candidate.sent_at;
  if (!(Number.isInteger(delay) && delay > 0 && baseAt)) {
    return false;
  }
  const dueAt = new Date(baseAt);
  if (Number.isNaN(dueAt.getTime())) {
    return false;
  }
  dueAt.setUTCDate(dueAt.getUTCDate() + delay);
  if (dueAt > now) {
    return false;
  }
  return insertFollowUpRequest(db, candidate, ordinal, delay, dueAt);
}

async function insertFollowUpRequest(
  db: D1Database,
  candidate: FollowUpCandidateRow,
  ordinal: number,
  delay: number,
  dueAt: Date
) {
  const followUpId = `follow-up:${candidate.source_kind}:${candidate.source_attempt_id}:${ordinal.toString()}`;
  const task = buildAgentTaskRequestCreation(db, {
    payload: { followUpId, kind: "follow_up", mode: "follow_up" },
    subjectId: followUpId,
    subjectType: "outreach_followup",
    taskType: APPLICATION_MESSAGE_TASK_TYPE,
    userId: candidate.user_id,
  });
  const timestamp = new Date().toISOString();
  const results = await db.batch([
    db
      .prepare(
        `INSERT INTO outreach_followups
          (id,user_id,source_kind,source_attempt_id,gmail_thread_id,ordinal,
           delay_days,due_at,status,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,'scheduled',?,?)
         ON CONFLICT(user_id,gmail_thread_id,ordinal) DO NOTHING`
      )
      .bind(
        followUpId,
        candidate.user_id,
        candidate.source_kind,
        candidate.source_attempt_id,
        candidate.gmail_thread_id,
        ordinal,
        delay,
        dueAt.toISOString(),
        timestamp,
        timestamp
      ),
    db
      .prepare(
        `INSERT INTO agent_task_requests
          (id,user_id,task_type,subject_type,subject_id,input_json,status,
           created_at,updated_at)
         SELECT ?,?,?,?,?,?,'queued',?,?
          WHERE EXISTS (
            SELECT 1 FROM outreach_followups
             WHERE id=? AND user_id=? AND agent_task_request_id IS NULL
          )`
      )
      .bind(
        task.request.id,
        candidate.user_id,
        APPLICATION_MESSAGE_TASK_TYPE,
        "outreach_followup",
        followUpId,
        JSON.stringify({ followUpId, kind: "follow_up", mode: "follow_up" }),
        timestamp,
        timestamp,
        followUpId,
        candidate.user_id
      ),
    db
      .prepare(
        `UPDATE outreach_followups SET agent_task_request_id=?,updated_at=?
          WHERE id=? AND user_id=? AND agent_task_request_id IS NULL`
      )
      .bind(task.request.id, timestamp, followUpId, candidate.user_id),
  ]);
  return (results[0]?.meta.changes ?? 0) === 1;
}

export async function readFollowUpSource(
  db: D1Database,
  userId: string,
  followUpId: string
) {
  const row = await db
    .prepare(
      `SELECT * FROM (
        SELECT f.id,f.user_id,f.source_kind,f.source_attempt_id,f.status,
               f.created_at,f.message,f.gmail_draft_id,a.gmail_thread_id,a.gmail_message_id,
               a.recipient,a.subject,d.message original_message,u.email from_email,
               j.title,j.company,j.country,j.location,j.message_route route
          FROM outreach_followups f
          JOIN application_attempts a ON a.id=f.source_attempt_id
          JOIN user_listing_states uj ON uj.id=a.user_job_id AND uj.user_id=f.user_id
          JOIN users u ON u.id=uj.user_id
          JOIN application_drafts d ON d.id=a.draft_id
          JOIN job_listings j ON j.id=uj.job_id
         WHERE f.source_kind='application'
        UNION ALL
        SELECT f.id,f.user_id,f.source_kind,f.source_attempt_id,f.status,
               f.created_at,f.message,f.gmail_draft_id,a.gmail_thread_id,a.gmail_message_id,
               a.recipient,a.subject,message.message original_message,u.email from_email,
               c.name title,
               COALESCE(j.company,o.name,c.name) company,
               market.country_name country,
               COALESCE(j.location,o.city,'') location,
               CASE
                 WHEN dispatch.route_strategy='anesl_bundle' THEN 'multi_position'
                 WHEN target.subject_kind='organization' THEN 'school_outreach'
                 ELSE COALESCE(j.message_route,'advertised_position')
               END route
          FROM outreach_followups f
          JOIN campaign_email_attempts a ON a.id=f.source_attempt_id
          JOIN campaign_dispatches dispatch ON dispatch.id=a.dispatch_id
          JOIN campaigns c ON c.id=dispatch.campaign_id AND c.user_id=f.user_id
          JOIN users u ON u.id=c.user_id
          JOIN campaign_messages message ON message.dispatch_id=dispatch.id
            AND message.status='sent'
          JOIN campaign_dispatch_targets dispatch_target
            ON dispatch_target.dispatch_id=dispatch.id
           AND dispatch_target.ordinal=0
          JOIN campaign_targets target ON target.id=dispatch_target.target_id
          JOIN campaign_markets market ON market.campaign_id=c.id
           AND market.country_code=target.country_code
          LEFT JOIN job_listings j ON j.id=target.job_id
          LEFT JOIN organizations o ON o.id=target.organization_id
         WHERE f.source_kind='campaign'
           AND message.version=(
             SELECT MAX(latest.version) FROM campaign_messages latest
              WHERE latest.dispatch_id=dispatch.id AND latest.status='sent'
           )
      ) source
      WHERE id=? AND user_id=? LIMIT 1`
    )
    .bind(followUpId, userId)
    .first<Record<string, unknown>>();
  if (!row) {
    throw new FollowUpError("Follow-up not found", 404);
  }
  return {
    company: String(row.company),
    country: String(row.country),
    created_at: String(row.created_at),
    from_email: String(row.from_email),
    gmail_draft_id: String(row.gmail_draft_id),
    gmail_message_id: String(row.gmail_message_id),
    gmail_thread_id: String(row.gmail_thread_id),
    id: String(row.id),
    location: String(row.location),
    message: String(row.message || row.original_message),
    recipient: String(row.recipient),
    route: String(row.route) as ApplicationMessageRoute,
    source_attempt_id: String(row.source_attempt_id),
    source_kind: String(row.source_kind) as "application" | "campaign",
    status: String(row.status),
    subject: String(row.subject),
    title: String(row.title),
    user_id: String(row.user_id),
  } satisfies FollowUpSourceRow;
}

export async function readFollowUp(
  db: D1Database,
  userId: string,
  followUpId: string
) {
  const row = await db
    .prepare(
      `SELECT id,ordinal,due_at,status,message,change_summary,gmail_draft_id
         FROM outreach_followups WHERE id=? AND user_id=?`
    )
    .bind(followUpId, userId)
    .first<{
      change_summary: string;
      due_at: string;
      gmail_draft_id: string;
      id: string;
      message: string;
      ordinal: number;
      status: string;
    }>();
  if (!row) {
    throw new FollowUpError("Follow-up not found", 404);
  }
  return {
    changeSummary: row.change_summary,
    dueAt: row.due_at,
    gmailDraftId: row.gmail_draft_id,
    id: row.id,
    message: row.message,
    ordinal: row.ordinal,
    status: row.status,
  } satisfies FollowUpView;
}
