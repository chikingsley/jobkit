import { exports } from "cloudflare:workers";
import type { AgentRunnerContext } from "../../../../../worker/app-types";
import { advancePublicProjectionRuns } from "../../../../../worker/services/public-projection/advancement";
import {
  futureTimestamp,
  type ProjectionRunResponse,
  type SeededListing,
  testEnv,
  timestamp,
} from "./model";

export async function seedExactTaskRuns(input: {
  count: number;
  listing: SeededListing;
  promptVersion: string;
  status: "completed" | "failed" | "running";
  taskType: string;
  userId: string;
}) {
  const runnerId = `runner:${input.listing.job.id}`;
  await testEnv.DB.prepare(
    `INSERT INTO agent_runners (
      id,user_id,name,token_hash,capabilities_json,codex_version,
      created_at,updated_at
    ) VALUES (?,?,? ,?, '["extraction"]','test',?,?)`
  )
    .bind(
      runnerId,
      input.userId,
      "Projection test runner",
      `token:${input.listing.job.id}`,
      timestamp,
      timestamp
    )
    .run();
  const statements = Array.from({ length: input.count }, (_, index) =>
    testEnv.DB.prepare(
      `INSERT INTO agent_task_runs (
        id,user_id,runner_id,task_type,source_task_id,prompt_version,model,
        reasoning_effort,source_hash,prompt_hash,attempt_number,lease_token,
        status,result_json,
        error_detail,started_at,lease_expires_at,completed_at,updated_at
      ) VALUES (?,?,?,?,?,?,'test-model','medium',?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      `task:${input.listing.job.id}:${index}`,
      input.userId,
      runnerId,
      input.taskType,
      input.listing.job.id,
      input.promptVersion,
      input.listing.sourceHash,
      index.toString(16).padStart(64, "0"),
      index + 1,
      `lease:${input.listing.job.id}:${index}`,
      input.status,
      input.status === "completed" ? "{}" : null,
      input.status === "failed" ? "deterministic validation failed" : "",
      timestamp,
      futureTimestamp,
      input.status === "running" ? null : timestamp,
      timestamp
    )
  );
  await testEnv.DB.batch(statements);
}

export async function seedRunner(
  userId: string,
  fixtureId: string
): Promise<AgentRunnerContext> {
  const runnerId = `runner:${fixtureId}`;
  await testEnv.DB.prepare(
    `INSERT INTO agent_runners (
      id,user_id,name,token_hash,capabilities_json,codex_version,
      created_at,updated_at
    ) VALUES (?,?,?,?,'["extraction"]','test',?,?)`
  )
    .bind(
      runnerId,
      userId,
      "Projection broker runner",
      `token:${fixtureId}`,
      timestamp,
      timestamp
    )
    .run();
  return {
    capabilities: ["extraction"],
    codexVersion: "test",
    id: runnerId,
    name: "Projection broker runner",
    user: {
      email: "phase-c-broker-priority@example.test",
      id: userId,
      name: "Integration User",
      role: "operator",
    },
  };
}

export async function createRun(
  cookie: string,
  scope: { boards: string[]; listingIds: string[] }
) {
  const response = await exports.default.fetch(
    "https://outreach.test/api/operator/public-projection/runs",
    {
      body: JSON.stringify({ mode: "shadow", scope }),
      headers: { "content-type": "application/json", cookie },
      method: "POST",
    }
  );
  if (response.status !== 202) {
    throw new Error(`Projection run creation returned ${response.status}`);
  }
  return ((await response.json()) as ProjectionRunResponse).run.id;
}

export async function advanceRunThroughExpansion() {
  return [
    await advancePublicProjectionRuns(testEnv.DB),
    await advancePublicProjectionRuns(testEnv.DB),
    await advancePublicProjectionRuns(testEnv.DB),
  ];
}

export function countingD1Database(db: D1Database) {
  let count = 0;
  const statementTargets = new WeakMap<object, D1PreparedStatement>();
  const executionMethods = new Set<PropertyKey>(["all", "first", "raw", "run"]);

  const wrapStatement = (statement: D1PreparedStatement) => {
    const wrapped = new Proxy(statement, {
      get(target, property) {
        if (property === "bind") {
          return (...values: unknown[]) =>
            wrapStatement(target.bind(...values));
        }
        const value = Reflect.get(target, property);
        if (executionMethods.has(property) && typeof value === "function") {
          return (...args: unknown[]) => {
            count += 1;
            return Reflect.apply(value, target, args);
          };
        }
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    statementTargets.set(wrapped, statement);
    return wrapped;
  };

  const counted = new Proxy(db, {
    get(target, property) {
      if (property === "prepare") {
        return (query: string) => wrapStatement(target.prepare(query));
      }
      if (property === "batch") {
        return (statements: D1PreparedStatement[]) => {
          count += statements.length;
          return target.batch(
            statements.map(
              (statement) => statementTargets.get(statement) ?? statement
            )
          );
        };
      }
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });

  return { count: () => count, db: counted };
}
