import { ANESL_KIND, ApplicationBundleError } from "./application-bundle-model";

export type ApplicationBundleStatus =
  | "approved"
  | "cancelled"
  | "failed"
  | "review"
  | "sent";

interface BundleRow {
  attempt_id: string | null;
  attempt_status: string | null;
  change_summary: string | null;
  created_at: string;
  draft_created_at: string | null;
  draft_id: string | null;
  draft_status: string | null;
  draft_task_json: string | null;
  draft_version: number | null;
  id: string;
  message: string | null;
  previous_message: string | null;
  recipient: string;
  revision_source: AneslApplicationDraft["revisionSource"] | null;
  sent_at: string | null;
  status: ApplicationBundleStatus;
  subject: string;
  test_recipient: string | null;
  test_reply_received_at: string | null;
  test_sent_at: string | null;
  test_status: string | null;
  updated_at: string;
}

interface AttachmentRow {
  application_bundle_id: string;
  category: string;
  filename: string;
  size_bytes: number;
}

export interface AneslApplicationTarget {
  jobId: string;
  location: string;
  ordinal: number;
  routeId: string;
  sourceReference: string;
  title: string;
}

export interface AneslApplicationDraft {
  attachments: Array<{
    category: string;
    filename: string;
    sizeBytes: number;
  }>;
  changeSummary: string;
  createdAt: string;
  id: string;
  message: string;
  previousMessage: string;
  revisionSource: "ai_revision" | "generated" | "manual_edit" | "undo";
  status: string;
  version: number;
}

export interface AneslApplicationSet {
  attempt: null | { id: string; status: string };
  createdAt: string;
  draft: AneslApplicationDraft | null;
  draftTask: {
    error: string;
    id: string;
    mode: "generate" | "revise";
    status: "cancelled" | "claimed" | "completed" | "failed" | "queued";
    updatedAt: string;
  } | null;
  id: string;
  recipient: string;
  sentAt: string | null;
  status: ApplicationBundleStatus;
  subject: string;
  targets: AneslApplicationTarget[];
  testSend: null | {
    recipient: string;
    replyReceivedAt: string | null;
    sentAt: string | null;
    status: string;
  };
  updatedAt: string;
}

export async function listAneslApplicationSets(
  db: D1Database,
  userId: string
): Promise<AneslApplicationSet[]> {
  const bundles = await db
    .prepare(
      `SELECT b.*,
              d.id draft_id,d.version draft_version,d.message,
              d.change_summary,d.revision_source,d.status draft_status,
              d.created_at draft_created_at,
              (SELECT previous.message FROM application_drafts previous
                WHERE previous.application_bundle_id=b.id
                  AND previous.version<d.version
                ORDER BY previous.version DESC LIMIT 1) previous_message,
              a.id attempt_id,a.status attempt_status,
              ts.recipient test_recipient,ts.status test_status,
              ts.sent_at test_sent_at,
              ts.reply_received_at test_reply_received_at,
              (
                SELECT json_object(
                  'id',atr.id,
                  'status',atr.status,
                  'mode',json_extract(atr.input_json,'$.mode'),
                  'error',atr.error_detail,
                  'updatedAt',atr.updated_at
                )
                FROM agent_task_requests atr
                WHERE atr.user_id=b.user_id
                  AND atr.task_type='application.message'
                  AND atr.subject_type='application_bundle'
                  AND atr.subject_id=b.id
                ORDER BY atr.created_at DESC LIMIT 1
              ) draft_task_json
         FROM application_bundles b
         LEFT JOIN application_drafts d ON d.id=(
           SELECT latest.id FROM application_drafts latest
            WHERE latest.application_bundle_id=b.id
            ORDER BY latest.version DESC LIMIT 1
         )
         LEFT JOIN application_attempts a ON a.id=(
           SELECT latest_attempt.id FROM application_attempts latest_attempt
            WHERE latest_attempt.application_bundle_id=b.id
            ORDER BY latest_attempt.created_at DESC LIMIT 1
         )
         LEFT JOIN application_bundle_test_sends ts ON ts.id=(
           SELECT latest_test.id FROM application_bundle_test_sends latest_test
            WHERE latest_test.bundle_id=b.id
            ORDER BY latest_test.created_at DESC LIMIT 1
         )
        WHERE b.user_id=? AND b.kind=?
        ORDER BY b.updated_at DESC
        LIMIT 25`
    )
    .bind(userId, ANESL_KIND)
    .all<BundleRow>();
  if (bundles.results.length === 0) {
    return [];
  }
  const ids = bundles.results.map((bundle) => bundle.id);
  const placeholders = ids.map(() => "?").join(",");
  const [targets, attachments] = await Promise.all([
    db
      .prepare(
        `SELECT bt.bundle_id application_bundle_id,bt.ordinal,
                bt.source_reference,bt.title,bt.location,bt.route_id,
                uj.job_id
           FROM application_bundle_targets bt
           JOIN user_jobs uj ON uj.id=bt.user_job_id
          WHERE bt.bundle_id IN (${placeholders})
          ORDER BY bt.bundle_id,bt.ordinal`
      )
      .bind(...ids)
      .all<Record<string, unknown>>(),
    db
      .prepare(
        `SELECT d.application_bundle_id,a.category,a.filename,a.size_bytes
           FROM application_drafts d
           JOIN application_draft_attachments a ON a.draft_id=d.id
          WHERE d.application_bundle_id IN (${placeholders})
            AND d.id=(
              SELECT latest.id FROM application_drafts latest
               WHERE latest.application_bundle_id=d.application_bundle_id
               ORDER BY latest.version DESC LIMIT 1
            )
          ORDER BY d.application_bundle_id,a.position`
      )
      .bind(...ids)
      .all<AttachmentRow>(),
  ]);
  const targetsByBundle = Map.groupBy(targets.results, (row) =>
    String(row.application_bundle_id)
  );
  const attachmentsByBundle = Map.groupBy(
    attachments.results,
    (row) => row.application_bundle_id
  );
  return bundles.results.map((row) =>
    toApplicationSet(
      row,
      targetsByBundle.get(row.id) ?? [],
      attachmentsByBundle.get(row.id) ?? []
    )
  );
}

export async function readAneslApplicationSet(
  db: D1Database,
  userId: string,
  bundleId: string
) {
  const bundles = await listAneslApplicationSets(db, userId);
  const bundle = bundles.find((candidate) => candidate.id === bundleId);
  if (!bundle) {
    throw new ApplicationBundleError("ANESL application set not found", 404);
  }
  return bundle;
}

function toApplicationSet(
  row: BundleRow,
  targets: Record<string, unknown>[],
  attachments: AttachmentRow[]
): AneslApplicationSet {
  return {
    attempt: row.attempt_id
      ? { id: row.attempt_id, status: row.attempt_status ?? "" }
      : null,
    createdAt: row.created_at,
    draft: row.draft_id
      ? {
          attachments: attachments.map((attachment) => ({
            category: attachment.category,
            filename: attachment.filename,
            sizeBytes: attachment.size_bytes,
          })),
          changeSummary: row.change_summary ?? "",
          createdAt: row.draft_created_at ?? row.created_at,
          id: row.draft_id,
          message: row.message ?? "",
          previousMessage: row.previous_message ?? "",
          revisionSource: row.revision_source ?? "generated",
          status: row.draft_status ?? "draft",
          version: row.draft_version ?? 1,
        }
      : null,
    draftTask: row.draft_task_json
      ? (JSON.parse(row.draft_task_json) as AneslApplicationSet["draftTask"])
      : null,
    id: row.id,
    recipient: row.recipient,
    sentAt: row.sent_at,
    status: row.status,
    subject: row.subject,
    targets: targets.map((target) => ({
      jobId: String(target.job_id),
      location: String(target.location),
      ordinal: Number(target.ordinal),
      routeId: String(target.route_id),
      sourceReference: String(target.source_reference),
      title: String(target.title),
    })),
    testSend: row.test_status
      ? {
          recipient: row.test_recipient ?? "",
          replyReceivedAt: row.test_reply_received_at,
          sentAt: row.test_sent_at,
          status: row.test_status,
        }
      : null,
    updatedAt: row.updated_at,
  };
}
