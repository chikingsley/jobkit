import type { AppEnv } from "../../../../../worker/env";
import { type RevisionFixture, testEnv } from "./model";

export async function requireLatestDraftId(userId: string, jobId: string) {
  const draft = await testEnv.DB.prepare(
    `SELECT draft.id
       FROM application_drafts draft
       JOIN user_listing_states state ON state.id=draft.user_job_id
      WHERE state.user_id=? AND state.job_id=?
      ORDER BY draft.version DESC LIMIT 1`
  )
    .bind(userId, jobId)
    .first<{ id: string }>();
  if (!draft) {
    throw new Error("Generated job draft was not found");
  }
  return draft.id;
}

export async function requireLatestBundleDraftId(bundleId: string) {
  const draft = await testEnv.DB.prepare(
    `SELECT id FROM application_drafts
      WHERE application_bundle_id=? ORDER BY version DESC LIMIT 1`
  )
    .bind(bundleId)
    .first<{ id: string }>();
  if (!draft) {
    throw new Error("Generated ANESL draft was not found");
  }
  return draft.id;
}

export async function requireThreeAttachments(draftId: string) {
  const count = await testEnv.DB.prepare(
    "SELECT COUNT(*) count FROM application_draft_attachments WHERE draft_id=?"
  )
    .bind(draftId)
    .first<{ count: number }>();
  if (count?.count !== 3) {
    throw new Error(`Expected three source attachments; found ${count?.count}`);
  }
}

export async function readRollbackState(fixture: RevisionFixture) {
  const [draft, draftCount, attachmentCount, request, run] = await Promise.all([
    testEnv.DB.prepare("SELECT status FROM application_drafts WHERE id=?")
      .bind(fixture.sourceDraftId)
      .first<{ status: string }>(),
    testEnv.DB.prepare(
      `SELECT COUNT(*) count FROM application_drafts
        WHERE user_job_id=(
          SELECT user_job_id FROM application_drafts WHERE id=?
        ) AND COALESCE(application_bundle_id,'')=COALESCE((
          SELECT application_bundle_id FROM application_drafts WHERE id=?
        ),'')`
    )
      .bind(fixture.sourceDraftId, fixture.sourceDraftId)
      .first<{ count: number }>(),
    testEnv.DB.prepare(
      "SELECT COUNT(*) count FROM application_draft_attachments WHERE draft_id=?"
    )
      .bind(fixture.sourceDraftId)
      .first<{ count: number }>(),
    testEnv.DB.prepare(
      "SELECT status,result_json FROM agent_task_requests WHERE id=?"
    )
      .bind(fixture.requestId)
      .first<{ result_json: string | null; status: string }>(),
    testEnv.DB.prepare(
      "SELECT status,result_json FROM agent_task_runs WHERE id=?"
    )
      .bind(fixture.runId)
      .first<{ result_json: string | null; status: string }>(),
  ]);
  return {
    attachmentCount: attachmentCount?.count ?? -1,
    draftCount: draftCount?.count ?? -1,
    guardPresent: [request?.result_json, run?.result_json].some((resultJson) =>
      Boolean(
        resultJson &&
          Object.hasOwn(JSON.parse(resultJson) as object, "completionGuard")
      )
    ),
    requestStatus: request?.status ?? "missing",
    runStatus: run?.status ?? "missing",
    sourceDraftStatus: draft?.status ?? "missing",
  };
}

export function interceptBatch(
  database: D1Database,
  interceptor: (
    statements: D1PreparedStatement[],
    target: D1Database
  ) => Promise<D1Result[]>
) {
  return new Proxy(database, {
    get(target, property) {
      if (property === "batch") {
        return (statements: D1PreparedStatement[]) =>
          interceptor(statements, target);
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

export function envWithDatabase(db: D1Database): AppEnv {
  return new Proxy(testEnv, {
    get(target, property) {
      if (property === "DB") {
        return db;
      }
      return Reflect.get(target, property, target);
    },
  });
}
