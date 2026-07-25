import { exports } from "cloudflare:workers";
import type { AgentRunnerContext } from "../../../../../worker/app-types";
import type { AppEnv } from "../../../../../worker/env";
import { importResume } from "../../../../../worker/services/profile-imports";
import { type CompletionFixture, testEnv } from "./model";

export async function uploadPng(cookie: string, filename: string) {
  const bytes = Uint8Array.from(
    atob(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
    ),
    (character) => character.charCodeAt(0)
  );
  const upload = await exports.default.fetch(
    "https://outreach.test/api/documents",
    {
      body: bytes,
      headers: {
        "content-length": String(bytes.byteLength),
        "content-type": "image/png",
        cookie,
        "x-jobkit-category": "test_lab",
        "x-jobkit-filename": encodeURIComponent(filename),
      },
      method: "PUT",
    }
  );
  if (upload.status !== 200) {
    throw new Error(`Test document upload failed (${upload.status})`);
  }
  const documents = await exports.default.fetch(
    "https://outreach.test/api/documents?scope=all",
    { headers: { cookie } }
  );
  const payload = (await documents.json()) as {
    documents: Array<{ filename: string; id: string }>;
  };
  const document = payload.documents.find((item) => item.filename === filename);
  if (!document) {
    throw new Error("Uploaded test document was not listed");
  }
  return document.id;
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

export function envWithOverrides(overrides: Partial<AppEnv>): AppEnv {
  return new Proxy(testEnv, {
    get(target, property) {
      if (Object.hasOwn(overrides, property)) {
        return Reflect.get(overrides, property);
      }
      return Reflect.get(target, property, target);
    },
  });
}

export function queueProfileImport(
  runner: AgentRunnerContext,
  filename: string
) {
  const resume =
    "Alex Teacher\nalex@example.test\n\nEnglish teacher with five years of classroom experience.\n\nTeacher, Example School, 2021 to Present\nTaught English to adult and teenage learners in group classes.";
  return importResume(
    testEnv,
    runner.user,
    new Request("https://outreach.test/api/profile-imports", {
      body: resume,
      headers: {
        "content-length": String(new TextEncoder().encode(resume).byteLength),
        "content-type": "text/plain",
        "x-jobkit-filename": filename,
      },
      method: "PUT",
    })
  );
}

export async function replaceQueuedRequestInput(
  requestId: string,
  userId: string,
  taskType: string,
  subjectId: string,
  inputJson: string
) {
  await testEnv.DB.batch([
    testEnv.DB.prepare("DELETE FROM agent_task_requests WHERE id=?").bind(
      requestId
    ),
    testEnv.DB.prepare(
      `INSERT INTO agent_task_requests
        (id,user_id,task_type,subject_type,subject_id,input_json,status,
         created_at,updated_at)
       VALUES (?,? ,?,'test_lab_run',?,?, 'queued',
               strftime('%Y-%m-%dT%H:%M:%fZ','now'),
               strftime('%Y-%m-%dT%H:%M:%fZ','now'))`
    ).bind(requestId, userId, taskType, subjectId, inputJson),
    testEnv.DB.prepare(
      "UPDATE test_lab_runs SET agent_task_request_id=? WHERE id=? AND user_id=?"
    ).bind(requestId, subjectId, userId),
  ]);
}

export function readQueuedAttempt(requestId: string) {
  return testEnv.DB.prepare(
    `SELECT status,attempt_count,last_error_code
       FROM agent_task_requests WHERE id=?`
  )
    .bind(requestId)
    .first<{
      attempt_count: number;
      last_error_code: string;
      status: string;
    }>();
}

export function readFailedRun(runId: string) {
  return testEnv.DB.prepare(
    `SELECT status,attempt_number,error_code,result_json
       FROM agent_task_runs WHERE id=?`
  )
    .bind(runId)
    .first<{
      attempt_number: number;
      error_code: string;
      result_json: string | null;
      status: string;
    }>();
}

export function profileProposalOutput() {
  const emptyText = { confidence: "low", evidence: "", value: "" };
  return {
    citizenship: emptyText,
    credentials: [],
    currentLocation: emptyText,
    education: [],
    email: {
      confidence: "high",
      evidence: "alex@example.test",
      value: "alex@example.test",
    },
    experienceLabel: emptyText,
    fullName: {
      confidence: "high",
      evidence: "Alex Teacher",
      value: "Alex Teacher",
    },
    introduction: {
      confidence: "high",
      evidence: "English teacher with five years of classroom experience.",
      value: "English teacher with five years of classroom experience.",
    },
    languages: [],
    phone: emptyText,
    reviewNotes: [],
    skills: [],
    subjectQualifications: [],
    workExperience: [],
  };
}

export async function readCompletionState(fixture: CompletionFixture) {
  const [run, request] = await Promise.all([
    testEnv.DB.prepare(
      "SELECT status,result_json FROM agent_task_runs WHERE id=?"
    )
      .bind(fixture.runId)
      .first<{ result_json: string | null; status: string }>(),
    testEnv.DB.prepare(
      "SELECT status,result_json FROM agent_task_requests WHERE id=?"
    )
      .bind(fixture.requestId)
      .first<{ result_json: string | null; status: string }>(),
  ]);
  let guardPresent = false;
  for (const resultJson of [run?.result_json, request?.result_json]) {
    if (resultJson) {
      guardPresent ||= Object.hasOwn(
        JSON.parse(resultJson) as object,
        "completionGuard"
      );
    }
  }
  return {
    guardPresent,
    requestStatus: request?.status ?? "missing",
    runStatus: run?.status ?? "missing",
  };
}

export async function countJobDrafts(userId: string, jobId: string) {
  const result = await testEnv.DB.prepare(
    `SELECT COUNT(*) count
       FROM application_drafts draft
       JOIN user_listing_states state ON state.id=draft.user_job_id
      WHERE state.user_id=? AND state.job_id=?`
  )
    .bind(userId, jobId)
    .first<{ count: number }>();
  return result?.count ?? 0;
}

export async function readUserJobStatus(userId: string, jobId: string) {
  const state = await testEnv.DB.prepare(
    "SELECT status FROM user_listing_states WHERE user_id=? AND job_id=?"
  )
    .bind(userId, jobId)
    .first<{ status: string }>();
  return state?.status ?? "missing";
}

export function readProfileImport(importId: string) {
  return testEnv.DB.prepare(
    "SELECT status,proposal_json FROM profile_imports WHERE id=?"
  )
    .bind(importId)
    .first<{ proposal_json: string | null; status: string }>();
}

export function readTestLabState(runId: string) {
  return testEnv.DB.prepare(
    "SELECT status,output_json FROM test_lab_runs WHERE id=?"
  )
    .bind(runId)
    .first<{ output_json: string | null; status: string }>();
}
