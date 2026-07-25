import { type ChildProcess, spawn } from "node:child_process";
import { resolve } from "node:path";
import { InventoryOperationEnvelopeSchema } from "../../src/features/inventory/schema";
import {
  prepareInventorySnapshot,
  publishInventorySnapshot,
} from "../job-inventory/publish";
import { JobKitAgentApiError, type JobKitAgentClient } from "./client";
import type { AgentConfig } from "./config";

const HEARTBEAT_INTERVAL_MS = 60_000;
const INVENTORY_BATCH_SIZE = 100;
const MAX_IN_FLIGHT_DETAIL_REQUESTS = 4;
const SOURCE_NAME = "Job search source inventory";
const collectorPath = resolve(import.meta.dir, "../../collectors");
const sourceDatabasePath = resolve(
  import.meta.dir,
  "../..",
  process.env.JOBKIT_JOBS_DB_PATH ?? ".jobkit/jobs.sqlite"
);

export async function claimAndRunInventoryOperation(
  client: JobKitAgentClient,
  config: AgentConfig
) {
  const response = await client.post("/api/inventory/operations/claim", {});
  const operation = InventoryOperationEnvelopeSchema.nullable().parse(
    response.operation
  );
  if (!operation) {
    return false;
  }

  console.log(
    `Refreshing ${operation.boards.length > 0 ? operation.boards.join(", ") : "all boards"} (${operation.mode})`
  );
  let heartbeatInFlight = false;
  let heartbeatStatus: "crawling" | "publishing" = "crawling";
  const state: { activeChild: ChildProcess | null; leaseError: Error | null } =
    {
      activeChild: null,
      leaseError: null,
    };
  const heartbeat = async () => {
    if (heartbeatInFlight || state.leaseError) {
      return;
    }
    heartbeatInFlight = true;
    try {
      await client.post(`/api/inventory/operations/${operation.id}/heartbeat`, {
        status: heartbeatStatus,
      });
    } catch (error) {
      if (error instanceof JobKitAgentApiError && error.status === 409) {
        state.leaseError = error;
        state.activeChild?.kill("SIGTERM");
      } else {
        console.warn(
          `Inventory heartbeat failed; the next heartbeat will retry: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    } finally {
      heartbeatInFlight = false;
    }
  };

  await heartbeat();
  if (state.leaseError) {
    console.error(
      `Inventory lease was lost before work began: ${state.leaseError.message}`
    );
    return true;
  }
  const heartbeatTimer = setInterval(
    () => void heartbeat(),
    HEARTBEAT_INTERVAL_MS
  );
  try {
    await runRefreshCommand(operation.mode, operation.boards, (child) => {
      state.activeChild = child;
    });
    state.activeChild = null;
    if (state.leaseError) {
      throw state.leaseError;
    }

    heartbeatStatus = "publishing";
    await heartbeat();
    if (state.leaseError) {
      throw state.leaseError;
    }
    const snapshot = await prepareInventorySnapshot(sourceDatabasePath);
    const published = await publishInventorySnapshot({
      batchSize: INVENTORY_BATCH_SIZE,
      config,
      onProgress(progress) {
        console.log(
          JSON.stringify({ event: "inventory_publish", ...progress })
        );
      },
      operationId: operation.id,
      snapshot,
      sourceId: operation.sourceId,
      sourceName: SOURCE_NAME,
    });
    await client.post(`/api/inventory/operations/${operation.id}/complete`, {
      inventoryRunId: published.inventoryRunId,
    });
    console.log(
      `Completed inventory refresh ${operation.id} (${snapshot.active} active records)`
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      await client.post(`/api/inventory/operations/${operation.id}/fail`, {
        error: message.slice(0, 4000),
      });
    } catch (failureError) {
      console.error(
        `Inventory failure could not be recorded: ${failureError instanceof Error ? failureError.message : String(failureError)}`
      );
    }
    console.error(`Inventory refresh failed: ${message}`);
  } finally {
    clearInterval(heartbeatTimer);
    state.activeChild?.kill("SIGTERM");
  }
  return true;
}

function runRefreshCommand(
  mode: "full" | "latest",
  boards: string[],
  onSpawn: (child: ChildProcess) => void
) {
  return runGoRefreshes(mode, boards, onSpawn);
}

const INVENTORY_BOARDS = [
  "ajarn",
  "anesl",
  "eslcafe-modern",
  "seriousteachers",
  "tefl",
] as const;

async function runGoRefreshes(
  mode: "full" | "latest",
  boards: string[],
  onSpawn: (child: ChildProcess) => void
) {
  const selected = boards.length > 0 ? boards : [...INVENTORY_BOARDS];
  for (const board of selected) {
    // biome-ignore lint/performance/noAwaitInLoops: Source refreshes are deliberately sequential to honor board request policies.
    await runGoRefresh(mode, board, onSpawn);
  }
}

function runGoRefresh(
  mode: "full" | "latest",
  board: string,
  onSpawn: (child: ChildProcess) => void
) {
  return new Promise<void>((resolveRun, reject) => {
    const child = spawn(
      "go",
      [
        "run",
        "./cmd/jobkit-collect",
        "refresh",
        board,
        "--mode",
        mode,
        "--detail-workers",
        String(MAX_IN_FLIGHT_DETAIL_REQUESTS),
        "--db",
        sourceDatabasePath,
      ],
      {
        cwd: collectorPath,
        env: process.env,
        stdio: "inherit",
      }
    );
    onSpawn(child);
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0) {
        resolveRun();
        return;
      }
      reject(
        new Error(
          signal
            ? `${board} inventory refresh stopped by ${signal}`
            : `${board} inventory refresh exited with code ${code ?? "unknown"}`
        )
      );
    });
  });
}
