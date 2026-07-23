import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import {
  localDevelopmentAuthEnabled,
  localDevelopmentUser,
} from "../src/features/auth/local-development";
import type { AgentRunnerContext, AuthUser, JobKitApp } from "./app-types";
import { createAuth } from "./auth";
import type { AppEnv } from "./env";
import { OnboardingIncompleteError } from "./repositories/onboarding";
import { OutboundRecipientClaimError } from "./repositories/outbound-recipient-claims";
import {
  readPreferences,
  readProfile,
  writePreferences,
  writeProfile,
} from "./repositories/user-settings";
import { registerAgentRunnerRoutes } from "./routes/agent-runners";
import { registerApplicationBundleRoutes } from "./routes/application-bundles";
import { registerApplicationDraftRoutes } from "./routes/application-drafts";
import { registerCampaignRoutes } from "./routes/campaigns";
import { registerCountryRoutes } from "./routes/countries";
import { registerDocumentRoutes } from "./routes/documents";
import { registerEmailAttemptRoutes } from "./routes/email-attempts";
import { GMAIL_PUBSUB_WEBHOOK_PATH, registerGmailRoutes } from "./routes/gmail";
import { registerInventoryRoutes } from "./routes/inventory";
import { registerJobMatchFactRoutes } from "./routes/job-match-facts";
import { registerJobPositionAnalysisRoutes } from "./routes/job-position-analyses";
import { registerJobRoutes } from "./routes/jobs";
import { registerMessagePreviewRoutes } from "./routes/message-preview";
import { registerMessageRoutes } from "./routes/messages";
import { registerOnboardingRoutes } from "./routes/onboarding";
import { registerPublicProjectionRoutes } from "./routes/public-projection";
import { registerTestLabRoutes } from "./routes/test-lab";
import { registerUserSettingsRoutes } from "./routes/user-settings";
import { ImportSchema, SubmitSchema } from "./schemas";
import { authenticateAgentRunner } from "./services/agent-runners";
import { queueAgentTaskMaintenance } from "./services/agent-task-maintenance-queue";
import { AgentTaskError } from "./services/agent-tasks/contracts";
import { ApplicationBundleError } from "./services/application-bundle-model";
import {
  DraftMessageFoundationRequiredError,
  DraftMutationError,
  DraftProfileRequiredError,
  importJobs,
} from "./services/application-drafts";
import {
  consumeJobKitQueue,
  type JobKitQueueMessage,
} from "./services/background-queue";
import { runCampaignMatchingPass } from "./services/campaign-matching";
import { runCampaignScheduler } from "./services/campaign-scheduler";
import { CampaignError } from "./services/campaigns";
import { CountryMarketError } from "./services/country-markets";
import { cleanupAbandonedCountrySweepOutputObjects } from "./services/country-materialization/cleanup";
import { reapExpiredCountryMaterializationItems } from "./services/country-materialization/materializer";
import { publishCountryMaterializationOutbox } from "./services/country-materialization/queue";
import { DocumentConversionError } from "./services/document-text";
import { EmailAttemptError } from "./services/email-attempts";
import { FollowUpError, queueDueFollowUps } from "./services/followups";
import { GmailIntegrationError } from "./services/gmail-errors";
import { renewExpiringGmailWatches } from "./services/gmail-integration";
import { processGoogleIndexingOutbox } from "./services/google-indexing";
import { queueDueInventoryRefreshes } from "./services/inventory-refreshes";
import { InventoryRunError } from "./services/inventory-runs/contracts";
import { JobAnalysisRecordError } from "./services/job-analysis-records";
import { approveAndSubmitApplication } from "./services/job-submission";
import { ensureLocalDevelopmentUser } from "./services/local-development-user";
import { searchLocations, searchUniversities } from "./services/lookups";
import { currentFxData } from "./services/matching-engine";
import { ResumeUploadError } from "./services/profile-imports";
import { PublicProjectionPromotionError } from "./services/public-projection/promotion/model";
import { queuePublicProjectionAdvance } from "./services/public-projection/queue";
import { PublicProjectionRunError } from "./services/public-projection/runs";
import { TestLabError } from "./services/test-lab/errors";

const app: JobKitApp = new OpenAPIHono<{
  Bindings: AppEnv;
  Variables: { agentRunner: AgentRunnerContext | null; user: AuthUser };
}>();
const jsonMessage = z.object({
  message: z.string().optional(),
  ok: z.boolean(),
});

function fixedErrorStatus(error: Error): ContentfulStatusCode | null {
  if (error instanceof DocumentConversionError) {
    return 422;
  }
  if (error instanceof DraftProfileRequiredError) {
    return 409;
  }
  if (error instanceof DraftMessageFoundationRequiredError) {
    return 409;
  }
  if (error instanceof OutboundRecipientClaimError) {
    return 409;
  }
  if (error instanceof OnboardingIncompleteError) {
    return 409;
  }
  return null;
}

function carriedErrorStatus(error: Error): ContentfulStatusCode | null {
  if (error instanceof ResumeUploadError) {
    return error.status;
  }
  if (error instanceof DraftMutationError) {
    return error.status;
  }
  if (error instanceof EmailAttemptError) {
    return error.status;
  }
  if (error instanceof ApplicationBundleError) {
    return error.status;
  }
  if (error instanceof GmailIntegrationError) {
    return error.status;
  }
  if (error instanceof FollowUpError) {
    return error.status;
  }
  if (error instanceof CountryMarketError) {
    return error.status;
  }
  if (error instanceof CampaignError) {
    return error.status;
  }
  if (error instanceof AgentTaskError) {
    return error.status;
  }
  if (error instanceof TestLabError) {
    return error.status;
  }
  if (error instanceof InventoryRunError) {
    return error.status;
  }
  if (error instanceof PublicProjectionRunError) {
    return error.status;
  }
  if (error instanceof PublicProjectionPromotionError) {
    return error.status;
  }
  return null;
}

app.onError((error, c) => {
  if (error instanceof z.ZodError) {
    return c.json(
      { message: "Request did not match the expected schema", ok: false },
      400
    );
  }
  console.error(
    JSON.stringify({
      event: "request_error",
      message: error.message,
      path: c.req.path,
    })
  );
  if (error instanceof JobAnalysisRecordError) {
    return c.json(
      {
        message: error.message,
        ok: false,
        ...(error.rejectedEvidence.length > 0
          ? { rejectedEvidence: error.rejectedEvidence }
          : {}),
      },
      error.status
    );
  }
  const status = carriedErrorStatus(error) ?? fixedErrorStatus(error);
  if (status !== null) {
    return c.json({ message: error.message, ok: false }, status);
  }
  return c.json({ message: "Internal server error", ok: false }, 500);
});

app.get("/api/health", (c) => c.json({ ok: true }));

app.on(["GET", "POST"], "/api/auth/*", (c) =>
  createAuth(c.env, c.req.raw).handler(c.req.raw)
);

const AGENT_PAIRING_EXCHANGE_PATH = "/api/agent-runner-pairings/exchange";
const AGENT_TASK_RESULT_PATH =
  /^\/api\/agent-tasks\/[^/]+\/(chunks|complete|fail|heartbeat)$/u;
const AGENT_TASK_ARTIFACT_PATH =
  /^\/api\/agent-tasks\/[^/]+\/artifacts\/[^/]+$/u;
const AGENT_TASK_CLAIM_PATH = "/api/agent-tasks/claim";
const INVENTORY_RUN_CREATE_PATH = "/api/inventory/runs";
const INVENTORY_RUN_MUTATION_PATH =
  /^\/api\/inventory\/runs\/[^/]+\/(batches|complete|fail)$/u;
const INVENTORY_OPERATION_CLAIM_PATH = "/api/inventory/operations/claim";
const INVENTORY_OPERATION_MUTATION_PATH =
  /^\/api\/inventory\/operations\/[^/]+\/(heartbeat|complete|fail)$/u;

function runnerRequestAllowed(method: string, path: string) {
  if (method === "GET") {
    return AGENT_TASK_ARTIFACT_PATH.test(path);
  }
  return (
    method === "POST" &&
    (path === AGENT_TASK_CLAIM_PATH ||
      path === INVENTORY_RUN_CREATE_PATH ||
      path === INVENTORY_OPERATION_CLAIM_PATH ||
      AGENT_TASK_RESULT_PATH.test(path) ||
      INVENTORY_RUN_MUTATION_PATH.test(path) ||
      INVENTORY_OPERATION_MUTATION_PATH.test(path))
  );
}

app.use("/api/*", async (c, next) => {
  if (
    c.req.path === GMAIL_PUBSUB_WEBHOOK_PATH ||
    (c.req.method === "POST" && c.req.path === AGENT_PAIRING_EXCHANGE_PATH)
  ) {
    await next();
    return;
  }
  const authorization = c.req.header("authorization") ?? "";
  if (authorization.startsWith("Bearer ")) {
    if (!runnerRequestAllowed(c.req.method, c.req.path)) {
      return c.json(
        {
          message: "Runner token is limited to agent task execution",
          ok: false,
        },
        403
      );
    }
    const runner = await authenticateAgentRunner(c.env.DB, authorization);
    if (!runner) {
      return c.json(
        { message: "Runner authentication failed", ok: false },
        401
      );
    }
    c.set("agentRunner", runner);
    c.set("user", runner.user);
    await next();
    return;
  }
  if (runnerRequestAllowed(c.req.method, c.req.path)) {
    return c.json(
      { message: "Agent runner authentication is required", ok: false },
      401
    );
  }
  if (localDevelopmentAuthEnabled) {
    await ensureLocalDevelopmentUser(c.env.DB);
    c.set("user", localDevelopmentUser);
    c.set("agentRunner", null);
    await next();
    return;
  }
  const session = await createAuth(c.env, c.req.raw).api.getSession({
    headers: c.req.raw.headers,
  });
  if (!session) {
    return c.json({ message: "Authentication required", ok: false }, 401);
  }
  const account = await c.env.DB.prepare("SELECT role FROM users WHERE id=?")
    .bind(session.user.id)
    .first<{ role: "member" | "operator" }>();
  c.set("user", {
    email: session.user.email,
    id: session.user.id,
    name: session.user.name,
    role: account?.role ?? "member",
  });
  c.set("agentRunner", null);
  await next();
});

app.get("/api/me", (c) => c.json({ user: c.get("user") }));

registerAgentRunnerRoutes(app);
registerOnboardingRoutes(app);
registerApplicationBundleRoutes(app);
registerApplicationDraftRoutes(app);
registerCampaignRoutes(app);
registerInventoryRoutes(app);
registerPublicProjectionRoutes(app);
registerJobRoutes(app);
registerJobMatchFactRoutes(app);
registerJobPositionAnalysisRoutes(app);
registerDocumentRoutes(app);
registerCountryRoutes(app);
registerEmailAttemptRoutes(app);
registerGmailRoutes(app);
registerMessageRoutes(app);
registerMessagePreviewRoutes(app);
registerTestLabRoutes(app);
registerUserSettingsRoutes(app);

app.get("/api/fx", async (c) => c.json(await currentFxData(c.env)));

app.get("/api/universities", async (c) => {
  const query = (c.req.query("q") ?? "").trim().slice(0, 100);
  const country = (c.req.query("country") ?? "").trim().slice(0, 100);
  if (query.length < 2) {
    return c.json({ universities: [] });
  }
  return c.json({ universities: await searchUniversities(query, country) });
});

app.get("/api/locations", async (c) => {
  const query = (c.req.query("q") ?? "").trim().slice(0, 180);
  if (query.length < 2) {
    return c.json({ locations: [] });
  }

  return c.json({
    locations: await searchLocations(query, c.env.MAPBOX_ACCESS_TOKEN),
  });
});

app.openapi(
  createRoute({
    method: "post",
    path: "/api/import",
    request: {
      body: { content: { "application/json": { schema: ImportSchema } } },
    },
    responses: {
      200: {
        content: { "application/json": { schema: jsonMessage } },
        description: "Imported jobs",
      },
      409: {
        content: { "application/json": { schema: jsonMessage } },
        description: "Profile required",
      },
    },
  }),
  async (c) => {
    const { jobs } = c.req.valid("json");
    await importJobs(c.env, c.get("user").id, jobs);
    return c.json({ message: `Imported ${jobs.length} jobs`, ok: true });
  }
);

app.get("/api/profile", async (c) => {
  const result = await readProfile(c.env.DB, c.get("user").id);
  return c.json({
    profile: result.value,
    updatedAt: result.updatedAt,
  });
});

app.put("/api/profile", async (c) => {
  await writeProfile(c.env.DB, c.get("user").id, await c.req.json());
  return c.json({ message: "Profile saved", ok: true });
});

app.get("/api/preferences", async (c) => {
  const result = await readPreferences(c.env.DB, c.get("user").id);
  return c.json({
    preferences: result.value,
    updatedAt: result.updatedAt,
  });
});

app.put("/api/preferences", async (c) => {
  await writePreferences(c.env.DB, c.get("user").id, await c.req.json());
  return c.json({ message: "Preferences saved", ok: true });
});

app.openapi(
  createRoute({
    method: "post",
    path: "/api/jobs/{id}/submit",
    request: {
      body: { content: { "application/json": { schema: SubmitSchema } } },
      params: z.object({ id: z.string() }),
    },
    responses: {
      200: {
        content: { "application/json": { schema: jsonMessage } },
        description: "Application submitted",
      },
      409: {
        content: { "application/json": { schema: jsonMessage } },
        description: "Draft or submission conflict",
      },
      502: {
        content: { "application/json": { schema: jsonMessage } },
        description: "Application board rejected the submission",
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    const { draftId } = c.req.valid("json");
    const outcome = await approveAndSubmitApplication(
      c.env,
      c.get("user").id,
      id,
      draftId
    );
    const body = { message: outcome.message, ok: outcome.status === 200 };
    if (outcome.status === 409) {
      return c.json(body, 409);
    }
    if (outcome.status === 502) {
      return c.json(body, 502);
    }
    return c.json(body, 200);
  }
);

app.doc("/openapi.json", {
  info: { title: "JobKit Outreach API", version: "0.1.0" },
  openapi: "3.1.0",
});

app.notFound((c) => c.json({ message: "Route not found", ok: false }, 404));

export default {
  fetch: app.fetch,
  queue(batch: MessageBatch<JobKitQueueMessage>, env: AppEnv) {
    return consumeJobKitQueue(batch, env);
  },
  scheduled(
    _controller: ScheduledController,
    env: AppEnv,
    ctx: ExecutionContext
  ) {
    ctx.waitUntil(
      Promise.all([
        renewExpiringGmailWatches(env),
        processGoogleIndexingOutbox(env),
        queueDueFollowUps(env),
        runCampaignMatchingPass(env),
        runCampaignScheduler(env),
        queueDueInventoryRefreshes(env.DB),
        queuePublicProjectionAdvance(env),
        queueAgentTaskMaintenance(env),
        publishCountryMaterializationOutbox(env),
        reapExpiredCountryMaterializationItems(env.DB),
        cleanupAbandonedCountrySweepOutputObjects(env),
      ]).then(
        ([
          gmail,
          indexing,
          followUps,
          matching,
          campaigns,
          inventory,
          projectionWake,
          agentTaskWake,
          countryMaterializationWake,
          countryMaterializationLeases,
          countryOutputCleanup,
        ]) => {
          console.log(
            JSON.stringify({
              agentTaskWake,
              campaigns,
              countryMaterializationLeases,
              countryMaterializationWake,
              countryOutputCleanup,
              event: "scheduled_maintenance",
              followUps,
              gmail,
              indexing,
              inventory,
              matching,
              projectionWake,
            })
          );
        }
      )
    );
  },
};
