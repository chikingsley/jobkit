import type { D1Migration } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { advertisedPositionQuestion } from "../../../../../worker/ai/application-message-policy";
import type { AgentRunnerContext } from "../../../../../worker/app-types";
import type { AppEnv } from "../../../../../worker/env";
import {
  upsertJob,
  upsertUserJob,
} from "../../../../../worker/repositories/jobs";
import { writeProfile } from "../../../../../worker/repositories/user-settings";
import { JobImportSchema } from "../../../../../worker/schemas";
import {
  claimApplicationMessageTask,
  completeApplicationMessageTask,
} from "../../../../../worker/services/agent-tasks/application-message-adapter";
import type { AgentTaskRunRow } from "../../../../../worker/services/agent-tasks/contracts";
import {
  claimProfileImportTask,
  completeProfileImportTask,
} from "../../../../../worker/services/agent-tasks/profile-import-adapter";
import { readOwnedRunningAgentTask } from "../../../../../worker/services/agent-tasks/run-store";
import {
  claimTestLabTask,
  completeTestLabTask,
} from "../../../../../worker/services/agent-tasks/test-lab-adapter";
import { queueJobDraftGeneration } from "../../../../../worker/services/application-drafts";
import { importResume } from "../../../../../worker/services/profile-imports";
import {
  startDocumentBenchmarkRun,
  startTestLabRun,
} from "../../../../../worker/services/test-lab/runs";
import { createAuthenticatedUser } from "../.././auth";
import {
  countJobDrafts,
  readProfileImport,
  readTestLabState,
  readUserJobStatus,
  uploadPng,
} from "./uploadpng";

export interface TestEnv extends Env {
  TEST_MIGRATIONS: D1Migration[];
}

export interface CompletionFixture {
  complete: (completionEnv: AppEnv) => Promise<unknown>;
  publishedState: DomainState;
  readDomainState: () => Promise<DomainState>;
  requestId: string;
  requiredWriteIndex: number;
  run: AgentTaskRunRow;
  runId: string;
  runner: AgentRunnerContext;
  unpublishedState: DomainState;
}

export interface DomainState {
  published: boolean;
  status: string;
}

export type FixtureFactory = (suffix: string) => Promise<CompletionFixture>;

export const testEnv = env as TestEnv;

export const FAMILIES: Array<{ create: FixtureFactory; name: string }> = [
  { create: createApplicationFixture, name: "application message" },
  { create: createProfileImportFixture, name: "profile import" },
  { create: createCorpusTestLabFixture, name: "Test Lab corpus" },
  { create: createDocumentTestLabFixture, name: "Test Lab document OCR" },
];

export async function createApplicationFixture(
  suffix: string
): Promise<CompletionFixture> {
  const email = `completion-app-${suffix}@example.test`;
  const { userId } = await createAuthenticatedUser(email);
  const runner = await createRunner(suffix, userId, email, ["drafting"]);
  const timestamp = "2026-07-22T00:00:00.000Z";
  const jobId = `completion-app-${suffix}-job`;
  await writeProfile(testEnv.DB, userId, {
    availability: "",
    citizenship: "United States",
    credentials: [],
    currentLocation: "Phoenix, Arizona",
    education: [],
    email,
    experienceLabel: "",
    fields: [],
    fullName: "Integration User",
    introduction: "I teach English to adult and teenage learners.",
    languages: [],
    phone: "",
    preferredName: "Integration",
    profileReviewNotes: [],
    subjectQualifications: [],
    workAuthorization: [],
    workExperience: [],
  });
  await seedMessageFoundation(userId, timestamp);
  const job = JobImportSchema.parse({
    applyEmail: "hiring@example.test",
    applyUrl: "",
    board: "fixture",
    company: "Example University",
    country: "China",
    description:
      "Example University is seeking an English instructor for adult learners.",
    id: jobId,
    location: "Jinan, China",
    messageRoute: "advertised_position",
    opportunityScope: "direct",
    salary: "25,000 CNY monthly",
    title: "English instructor",
  });
  await upsertJob(testEnv.DB, job, timestamp);
  await upsertUserJob(testEnv.DB, userId, jobId, 1, timestamp);
  const request = await queueJobDraftGeneration(testEnv, userId, jobId);
  const task = await claimApplicationMessageTask(testEnv, runner);
  if (!task) {
    throw new Error("Application fixture task was not claimed");
  }
  const run = await readOwnedRunningAgentTask(testEnv.DB, runner, task.runId);
  const question = advertisedPositionQuestion(new Date(), "UTC");
  const output = {
    message: `Hello,\n\nI teach English to adult and teenage learners and would be glad to discuss the English instructor role.\n\n${question}\n\nBest,\nIntegration User\nE: ${email}`,
    summary: "Focused the message on adult English teaching.",
  };
  return {
    complete: (completionEnv) =>
      completeApplicationMessageTask(
        completionEnv,
        runner,
        run,
        task.runId,
        output
      ),
    publishedState: { published: true, status: "review" },
    readDomainState: async () => {
      const [drafts, status] = await Promise.all([
        countJobDrafts(userId, jobId),
        readUserJobStatus(userId, jobId),
      ]);
      return { published: drafts === 1, status };
    },
    requestId: request.id,
    requiredWriteIndex: 3,
    run,
    runId: task.runId,
    runner,
    unpublishedState: { published: false, status: "new" },
  };
}

export async function createProfileImportFixture(
  suffix: string
): Promise<CompletionFixture> {
  const email = `completion-profile-${suffix}@example.test`;
  const { userId } = await createAuthenticatedUser(email);
  const runner = await createRunner(suffix, userId, email, ["extraction"]);
  const resume =
    "Alex Teacher\nalex@example.test\n\nEnglish teacher with five years of classroom experience.\n\nTeacher, Example School, 2021 to Present\nTaught English to adult and teenage learners in group classes.";
  const upload = await importResume(
    testEnv,
    runner.user,
    new Request("https://outreach.test/api/profile-imports", {
      body: resume,
      headers: {
        "content-length": String(new TextEncoder().encode(resume).byteLength),
        "content-type": "text/plain",
        "x-jobkit-filename": "resume.txt",
      },
      method: "PUT",
    })
  );
  const task = await claimProfileImportTask(testEnv, runner);
  if (!task) {
    throw new Error("Profile import fixture task was not claimed");
  }
  const run = await readOwnedRunningAgentTask(testEnv.DB, runner, task.runId);
  const emptyText = { confidence: "low", evidence: "", value: "" };
  const output = {
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
  return {
    complete: (completionEnv) =>
      completeProfileImportTask(completionEnv, runner, run, task.runId, output),
    publishedState: { published: true, status: "ready" },
    readDomainState: async () => {
      const state = await readProfileImport(upload.id);
      return {
        published: state?.proposal_json !== null,
        status: state?.status ?? "missing",
      };
    },
    requestId: run.source_task_id,
    requiredWriteIndex: 2,
    run,
    runId: task.runId,
    runner,
    unpublishedState: { published: false, status: "processing" },
  };
}

export async function createCorpusTestLabFixture(
  suffix: string
): Promise<CompletionFixture> {
  const email = `completion-test-lab-${suffix}@example.test`;
  const { userId } = await createAuthenticatedUser(email);
  const runner = await createRunner(suffix, userId, email, ["evaluation"]);
  const testLabRun = await startTestLabRun(
    testEnv,
    userId,
    "classification-01",
    "codex"
  );
  const task = await claimTestLabTask(testEnv, runner);
  if (!task) {
    throw new Error("Test Lab corpus fixture task was not claimed");
  }
  const run = await readOwnedRunningAgentTask(testEnv.DB, runner, task.runId);
  return testLabFixture({
    output: { label: "english_teaching" },
    run,
    runner,
    taskRunId: task.runId,
    testLabRunId: testLabRun.id,
  });
}

export async function createDocumentTestLabFixture(
  suffix: string
): Promise<CompletionFixture> {
  const email = `completion-document-${suffix}@example.test`;
  const { cookie, userId } = await createAuthenticatedUser(email);
  const runner = await createRunner(suffix, userId, email, ["evaluation"]);
  const documentId = await uploadPng(cookie, `completion-${suffix}.png`);
  const testLabRun = await startDocumentBenchmarkRun(testEnv, userId, {
    documentId,
    expectedText: "Visible fixture text",
    variant: "codex_vision",
  });
  const task = await claimTestLabTask(testEnv, runner);
  if (!task) {
    throw new Error("Test Lab document fixture task was not claimed");
  }
  const run = await readOwnedRunningAgentTask(testEnv.DB, runner, task.runId);
  return testLabFixture({
    output: { pages: [{ index: 0, markdown: "Visible fixture text" }] },
    run,
    runner,
    taskRunId: task.runId,
    testLabRunId: testLabRun.id,
  });
}

export function testLabFixture(input: {
  output: unknown;
  run: AgentTaskRunRow;
  runner: AgentRunnerContext;
  taskRunId: string;
  testLabRunId: string;
}): CompletionFixture {
  return {
    complete: (completionEnv) =>
      completeTestLabTask(
        completionEnv,
        input.runner,
        input.run,
        input.taskRunId,
        input.output
      ),
    publishedState: { published: true, status: "completed" },
    readDomainState: async () => {
      const state = await readTestLabState(input.testLabRunId);
      return {
        published: state?.output_json !== null,
        status: state?.status ?? "missing",
      };
    },
    requestId: input.run.source_task_id,
    requiredWriteIndex: 2,
    run: input.run,
    runId: input.taskRunId,
    runner: input.runner,
    unpublishedState: { published: false, status: "running" },
  };
}

export async function createRunner(
  suffix: string,
  userId: string,
  email: string,
  capabilities: AgentRunnerContext["capabilities"]
) {
  const timestamp = new Date().toISOString();
  const runner: AgentRunnerContext = {
    capabilities,
    codexVersion: "codex-cli test",
    id: `completion-${suffix}-${crypto.randomUUID()}`,
    name: "Completion fence agent",
    user: {
      email,
      id: userId,
      name: "Integration User",
      role: "operator",
    },
  };
  await testEnv.DB.prepare(
    `INSERT INTO agent_runners
      (id,user_id,name,token_hash,capabilities_json,codex_version,last_seen_at,
       created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?)`
  )
    .bind(
      runner.id,
      userId,
      runner.name,
      `${runner.id}-token`,
      JSON.stringify(runner.capabilities),
      runner.codexVersion,
      timestamp,
      timestamp,
      timestamp
    )
    .run();
  return runner;
}

export async function seedMessageFoundation(userId: string, timestamp: string) {
  const template = "Hello,\n\n[profile-backed application message]";
  await testEnv.DB.prepare(
    `INSERT INTO user_message_foundations
      (id,user_id,version,name,status,voice_rules_json,templates_json,
       created_at,activated_at)
     VALUES (?,?,1,'Test foundation','active',?,?,?,?)`
  )
    .bind(
      `foundation:${userId}`,
      userId,
      JSON.stringify(["Use plain American English."]),
      JSON.stringify({
        advertised_long_general: template,
        advertised_long_young: template,
        advertised_short: template,
        multi_position: template,
        school_outreach_long: template,
        school_outreach_short: template,
      }),
      timestamp,
      timestamp
    )
    .run();
}
