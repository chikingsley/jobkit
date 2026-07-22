import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  JOB_CONTENT_TASK_TYPE,
  JOB_MATCH_FACTS_TASK_TYPE,
  JOB_POSITION_TASK_TYPE,
} from "../../../src/agent-tasks/job-analysis";
import { jobSourceHash } from "../../../worker/ai/job-fact-extraction";
import type { AgentRunnerContext } from "../../../worker/app-types";
import type { AgentTaskRunRow } from "../../../worker/services/agent-tasks/contracts";
import {
  completeJobContentTask,
  completeJobMatchFactsTask,
  completeJobPositionTask,
} from "../../../worker/services/agent-tasks/job-analysis-adapter";
import { createAuthenticatedUser } from "./auth";

interface TestEnv extends Env {
  TEST_MIGRATIONS: D1Migration[];
}

interface CompletionFixture {
  jobId: string;
  run: AgentTaskRunRow;
  runId: string;
}

const testEnv = env as TestEnv;

beforeEach(() => applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS));

describe("agent task completion fencing", () => {
  it("publishes no autonomous analysis after its runner is revoked", async () => {
    const { runner, userId } = await createRunner("revoked");
    const fixture = await createCompletionFixture(
      testEnv.DB,
      userId,
      runner.id,
      "revoked-content",
      JOB_CONTENT_TASK_TYPE,
      "2099-01-01T00:00:00.000Z"
    );
    await testEnv.DB.prepare(
      `UPDATE agent_runners
          SET revoked_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE id=? AND user_id=?`
    )
      .bind(runner.id, userId)
      .run();

    await expect(
      completeJobContentTask(
        testEnv,
        runner,
        fixture.run,
        fixture.runId,
        contentOutput()
      )
    ).rejects.toMatchObject({ status: 409 });

    await expect(countRows("job_content_analyses")).resolves.toBe(0);
    await expect(readRunStatus(fixture.runId)).resolves.toBe("running");
  });

  it("publishes no job analysis from expired runs", async () => {
    const { runner, userId } = await createRunner("expired");
    const position = await createCompletionFixture(
      testEnv.DB,
      userId,
      runner.id,
      "expired-position",
      JOB_POSITION_TASK_TYPE,
      "2000-01-01T00:00:00.000Z"
    );
    const matchFacts = await createCompletionFixture(
      testEnv.DB,
      userId,
      runner.id,
      "expired-match-facts",
      JOB_MATCH_FACTS_TASK_TYPE,
      "2000-01-01T00:00:00.000Z"
    );
    const content = await createCompletionFixture(
      testEnv.DB,
      userId,
      runner.id,
      "expired-content",
      JOB_CONTENT_TASK_TYPE,
      "2000-01-01T00:00:00.000Z"
    );

    await expect(
      completeJobPositionTask(
        testEnv,
        runner,
        position.run,
        position.runId,
        positionOutput()
      )
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      completeJobMatchFactsTask(
        testEnv,
        runner,
        matchFacts.run,
        matchFacts.runId,
        matchFactsOutput()
      )
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      completeJobContentTask(
        testEnv,
        runner,
        content.run,
        content.runId,
        contentOutput()
      )
    ).rejects.toMatchObject({ status: 409 });

    await expect(countRows("job_position_analyses")).resolves.toBe(0);
    await expect(countRows("job_position_variants")).resolves.toBe(0);
    await expect(countRows("job_match_facts")).resolves.toBe(0);
    await expect(countRows("job_content_analyses")).resolves.toBe(0);
    await expect(
      testEnv.DB.prepare(
        `SELECT COUNT(*) count FROM agent_task_runs
          WHERE status='running' AND user_id=?`
      )
        .bind(userId)
        .first<{ count: number }>()
    ).resolves.toEqual({ count: 3 });
  });

  it("publishes no content when another actor terminalizes the run before the batch", async () => {
    const { runner, userId } = await createRunner("terminalized");
    const fixture = await createCompletionFixture(
      testEnv.DB,
      userId,
      runner.id,
      "terminalized-content",
      JOB_CONTENT_TASK_TYPE,
      "2099-01-01T00:00:00.000Z"
    );
    let intercepted = false;
    const db = interceptBatch(testEnv.DB, async (statements, target) => {
      intercepted = true;
      await target
        .prepare(
          `UPDATE agent_task_runs
              SET status='failed',error_detail='terminalized elsewhere'
            WHERE id=?`
        )
        .bind(fixture.runId)
        .run();
      return target.batch(statements);
    });
    const proxiedEnv = envWithDatabase(db);

    await expect(
      completeJobContentTask(
        proxiedEnv,
        runner,
        fixture.run,
        fixture.runId,
        contentOutput()
      )
    ).rejects.toMatchObject({ status: 409 });

    expect(intercepted).toBe(true);
    await expect(countRows("job_content_analyses")).resolves.toBe(0);
    await expect(readRunStatus(fixture.runId)).resolves.toBe("failed");
  });

  it("rolls domain and completion writes back when the D1 batch fails", async () => {
    const { runner, userId } = await createRunner("batch-failure");
    const fixture = await createCompletionFixture(
      testEnv.DB,
      userId,
      runner.id,
      "batch-failure-content",
      JOB_CONTENT_TASK_TYPE,
      "2099-01-01T00:00:00.000Z"
    );
    const db = interceptBatch(testEnv.DB, (statements, target) =>
      target.batch([
        ...statements,
        target
          .prepare("INSERT INTO job_content_analyses (job_id) VALUES (?)")
          .bind(fixture.jobId),
      ])
    );
    const proxiedEnv = envWithDatabase(db);

    await expect(
      completeJobContentTask(
        proxiedEnv,
        runner,
        fixture.run,
        fixture.runId,
        contentOutput()
      )
    ).rejects.toThrow();

    await expect(countRows("job_content_analyses")).resolves.toBe(0);
    await expect(readRunStatus(fixture.runId)).resolves.toBe("running");
  });
});

async function createRunner(suffix: string) {
  const email = `agent-completion-${suffix}@example.test`;
  const { userId } = await createAuthenticatedUser(email);
  const timestamp = "2026-07-22T00:00:00.000Z";
  const runner: AgentRunnerContext = {
    capabilities: ["extraction"],
    codexVersion: "codex-cli test",
    id: `agent-completion-${suffix}-runner`,
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
      (id,user_id,name,token_hash,capabilities_json,codex_version,created_at,
       updated_at)
     VALUES (?,?,?,?,?,?,?,?)`
  )
    .bind(
      runner.id,
      userId,
      runner.name,
      `agent-completion-${suffix}-token`,
      JSON.stringify(runner.capabilities),
      runner.codexVersion,
      timestamp,
      timestamp
    )
    .run();
  return { runner, userId };
}

async function createCompletionFixture(
  db: D1Database,
  userId: string,
  runnerId: string,
  suffix: string,
  taskType: string,
  leaseExpiresAt: string
): Promise<CompletionFixture> {
  const jobId = `agent-completion-${suffix}-job`;
  const runId = `agent-completion-${suffix}-run`;
  const leaseToken = `agent-completion-${suffix}-lease`;
  const timestamp = "2026-07-22T00:00:00.000Z";
  const source = {
    company: "Example School",
    description: "We need an English teacher. Salary is 25,000 CNY monthly.",
    salary: "25,000 CNY monthly",
    title: "English teacher",
  };
  const sourceHash = await jobSourceHash(source);
  await db.batch([
    db
      .prepare(
        `INSERT INTO job_listings
          (id,title,company,salary,description,apply_url,first_seen_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?)`
      )
      .bind(
        jobId,
        source.title,
        source.company,
        source.salary,
        source.description,
        `https://example.test/${suffix}`,
        timestamp,
        timestamp
      ),
    db
      .prepare(
        `INSERT INTO agent_task_runs
          (id,user_id,runner_id,task_type,source_task_id,prompt_version,model,
           reasoning_effort,source_hash,prompt_hash,status,started_at,
           lease_expires_at,updated_at,attempt_number,lease_token)
         VALUES (?,?,?,?,?,?,'gpt-5.6-terra','medium',?,'prompt-hash','running',
                 ?,?,?,1,?)`
      )
      .bind(
        runId,
        userId,
        runnerId,
        taskType,
        jobId,
        "completion-fence-test-v1",
        sourceHash,
        timestamp,
        leaseExpiresAt,
        timestamp,
        leaseToken
      ),
  ]);
  return {
    jobId,
    run: {
      attempt_number: 1,
      lease_token: leaseToken,
      model: "gpt-5.6-terra",
      source_hash: sourceHash,
      source_task_id: jobId,
      status: "running",
      task_type: taskType,
    },
    runId,
  };
}

function positionOutput() {
  return {
    positions: [
      {
        audiences: [],
        certainty: "explicit",
        compensationEvidence: ["Salary is 25,000 CNY monthly"],
        employmentTypes: [],
        evidence: ["English teacher"],
        locations: [],
        requirements: [],
        roleFamily: "english_language",
        subjects: [{ evidence: "English teacher", value: "english" }],
        title: "English teacher",
      },
    ],
    reviewNotes: [],
    scope: "direct",
  };
}

function matchFactsOutput() {
  return {
    audiences: [],
    benefits: [],
    economics: {
      compensation: {
        amountMaximum: null,
        amountMinimum: null,
        currency: null,
        evidence: [],
        kind: "unstated",
        period: null,
        qualifier: null,
        taxBasis: "unspecified",
      },
      workload: null,
    },
    employmentTypes: [],
    marketSegments: [],
    requirements: [],
    reviewNotes: [],
  };
}

function contentOutput() {
  return {
    additionalSections: [],
    applicationProcess: [],
    overview: [
      {
        evidence: ["We need an English teacher"],
        text: "The employer is seeking an English teacher.",
      },
    ],
    responsibilities: [],
    scheduleAndContract: [],
    teachingContext: [],
    unplacedEvidence: [],
  };
}

function interceptBatch(
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

function envWithDatabase(db: D1Database) {
  return new Proxy(testEnv, {
    get(target, property) {
      if (property === "DB") {
        return db;
      }
      return Reflect.get(target, property, target);
    },
  });
}

async function countRows(table: string) {
  const result = await testEnv.DB.prepare(
    `SELECT COUNT(*) count FROM ${table}`
  ).first<{ count: number }>();
  return result?.count ?? 0;
}

async function readRunStatus(runId: string) {
  const result = await testEnv.DB.prepare(
    "SELECT status FROM agent_task_runs WHERE id=?"
  )
    .bind(runId)
    .first<{ status: string }>();
  return result?.status ?? null;
}
