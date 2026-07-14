import type { AppEnv } from "../env";
import { jobEventStatement } from "../repositories/job-events";
import { submitApplication } from "../seriousteachers";

interface SubmissionRow {
  apply_url: string;
  draft_id: string;
  draft_status: string;
  job_status: string;
  message: string;
}

export interface SubmissionOutcome {
  message: string;
  status: 200 | 409 | 502;
}

const retryableDraftStatuses = new Set(["approved", "draft"]);
const retryableJobStatuses = new Set(["approved", "failed", "review"]);

export async function approveAndSubmitApplication(
  env: AppEnv,
  jobId: string,
  draftId: string
): Promise<SubmissionOutcome> {
  const row = await env.DB.prepare(
    `SELECT j.apply_url,j.status job_status,d.id draft_id,d.status draft_status,d.message
     FROM jobs j
     JOIN application_drafts d ON d.job_id=j.id
     WHERE j.id=? AND d.id=?
       AND d.id=(SELECT id FROM application_drafts WHERE job_id=j.id ORDER BY version DESC LIMIT 1)`
  )
    .bind(jobId, draftId)
    .first<SubmissionRow>();

  if (!row) {
    return { message: "The selected draft is no longer current", status: 409 };
  }
  if (row.job_status === "applied" || row.draft_status === "submitted") {
    return { message: "Application was already sent", status: 200 };
  }
  if (
    !(
      retryableJobStatuses.has(row.job_status) &&
      retryableDraftStatuses.has(row.draft_status)
    )
  ) {
    return {
      message: "Application is not ready to approve and send",
      status: 409,
    };
  }

  const timestamp = new Date().toISOString();
  const approvalStatements = [
    env.DB.prepare(
      "UPDATE jobs SET status='submitting',updated_at=? WHERE id=? AND status IN ('review','approved','failed')"
    ).bind(timestamp, jobId),
    env.DB.prepare(
      "UPDATE application_drafts SET status='approved',approved_at=COALESCE(approved_at,?) WHERE id=? AND status IN ('draft','approved')"
    ).bind(timestamp, draftId),
  ];
  if (row.draft_status === "draft") {
    approvalStatements.push(
      jobEventStatement(
        env.DB,
        jobId,
        "approved",
        "Exact draft approved for submission",
        draftId
      )
    );
  }
  const [jobUpdate, draftUpdate] = await env.DB.batch(approvalStatements);
  if (
    (jobUpdate?.meta.changes ?? 0) !== 1 ||
    (draftUpdate?.meta.changes ?? 0) !== 1
  ) {
    return { message: "Submission is already in progress", status: 409 };
  }

  let submission: Awaited<ReturnType<typeof submitApplication>>;
  try {
    submission = await submitApplication(env, row.apply_url, row.message);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown submission error";
    const failedAt = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE jobs SET status='failed',updated_at=? WHERE id=?"
      ).bind(failedAt, jobId),
      jobEventStatement(env.DB, jobId, "submission_failed", message, draftId),
    ]);
    return { message, status: 502 };
  }

  const submittedAt = new Date().toISOString();
  if (!submission.submittedNow) {
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE jobs SET status='applied',updated_at=? WHERE id=?"
      ).bind(submittedAt, jobId),
      jobEventStatement(
        env.DB,
        jobId,
        "submission_reconciled",
        `Serious Teachers already recorded an application on ${submission.appliedDate}; the current draft was not submitted`
      ),
    ]);
    return {
      message: `Application was already recorded (${submission.appliedDate})`,
      status: 200,
    };
  }

  await env.DB.batch([
    env.DB.prepare(
      "UPDATE jobs SET status='applied',updated_at=? WHERE id=?"
    ).bind(submittedAt, jobId),
    env.DB.prepare(
      "UPDATE application_drafts SET status='submitted',submitted_at=? WHERE id=?"
    ).bind(submittedAt, draftId),
    jobEventStatement(
      env.DB,
      jobId,
      "submitted",
      `Serious Teachers verified last applied on ${submission.appliedDate}`,
      draftId
    ),
  ]);
  return {
    message: `Application sent and verified (${submission.appliedDate})`,
    status: 200,
  };
}
