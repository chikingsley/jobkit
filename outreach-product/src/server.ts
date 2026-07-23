import {
  createStartHandler,
  defaultStreamHandler,
} from "@tanstack/react-start/server";
import type { AppEnv } from "../worker/env";
import worker from "../worker/index";
import type { JobKitQueueMessage } from "../worker/services/background-queue";
import { publicSearchAssetResponse } from "../worker/services/public-search-assets";
import type {
  JobKitStartRegister,
  JobKitStartRequestContext,
} from "./server-context";
import { createRoutedWorker } from "./server-routing";

const startHandler =
  createStartHandler<JobKitStartRegister>(defaultStreamHandler);

export default createRoutedWorker<AppEnv, JobKitQueueMessage>({
  fetchHono: (request, env, ctx) => worker.fetch(request, env, ctx),
  fetchStart: async (request, env, executionContext) =>
    (await publicSearchAssetResponse(request, env)) ??
    startHandler(request, {
      context: {
        env,
        executionContext,
        request,
      } satisfies JobKitStartRequestContext,
    }),
  runQueue: (batch, env) => worker.queue(batch, env),
  runScheduled: (controller, env, ctx) =>
    worker.scheduled(controller, env, ctx),
}) satisfies ExportedHandler<AppEnv, JobKitQueueMessage>;
