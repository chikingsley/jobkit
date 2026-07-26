import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Database } from "../../db/client";
import { CANDIDATE } from "../04_compose/candidate";

export interface RecordedSend {
  channel: "board_form" | "email" | "login_gated_form";
  confirmationUrl: string;
  jobId: string;
  message: string;
  recipient: string;
  sentAt: string;
  status: "failed" | "sent";
  subject?: string;
}

export const OPERATOR_ID = "operator";

export function ensureOperator(db: Database, when: string) {
  db.run(sql`
    INSERT INTO users (id, name, email, email_verified, created_at, updated_at)
    VALUES (${OPERATOR_ID}, ${CANDIDATE.fullName}, ${CANDIDATE.email}, 1, ${when}, ${when})
    ON CONFLICT(id) DO NOTHING
  `);
}

export function recordSend(db: Database, send: RecordedSend): string {
  const when = send.sentAt;
  ensureOperator(db, when);

  const userJobId = `uj:${OPERATOR_ID}:${send.jobId}`;
  db.run(sql`
    INSERT INTO user_listing_states (id, user_id, job_id, status, created_at, updated_at)
    VALUES (${userJobId}, ${OPERATOR_ID}, ${send.jobId}, 'applied', ${when}, ${when})
    ON CONFLICT(id) DO UPDATE SET status='applied', updated_at=${when}
  `);

  const draftId = `draft:${send.jobId}`;
  db.run(sql`
    INSERT INTO application_drafts (id, user_job_id, version, message, created_at)
    VALUES (${draftId}, ${userJobId}, 1, ${send.message}, ${when})
    ON CONFLICT(id) DO UPDATE SET message=${send.message}
  `);

  const routeId = db
    .all<{ id: string }>(
      sql`SELECT id FROM application_routes WHERE job_id=${send.jobId} AND status='active' LIMIT 1`
    )
    .at(0)?.id;
  if (!routeId) {
    throw new Error(`no active route for ${send.jobId}`);
  }

  const attemptId = randomUUID();
  db.run(sql`
    INSERT INTO application_attempts (
      id, user_job_id, draft_id, route_id, channel, recipient, subject,
      status, confirmation_url, approved_at, sent_at, created_at, updated_at
    ) VALUES (
      ${attemptId}, ${userJobId}, ${draftId}, ${routeId}, ${send.channel},
      ${send.recipient}, ${send.subject ?? ""}, ${send.status},
      ${send.confirmationUrl}, ${when}, ${when}, ${when}, ${when}
    )
    ON CONFLICT(user_job_id,draft_id,route_id) DO UPDATE SET
      status=${send.status}, sent_at=${when}, updated_at=${when},
      confirmation_url=${send.confirmationUrl}
  `);
  return attemptId;
}

export function alreadyApplied(db: Database, jobId: string): boolean {
  return (
    (db
      .all<{ n: number }>(
        sql`SELECT COUNT(*) n FROM application_attempts a
            JOIN user_listing_states s ON s.id = a.user_job_id
            WHERE s.job_id = ${jobId} AND a.status = 'sent'`
      )
      .at(0)?.n ?? 0) > 0
  );
}
