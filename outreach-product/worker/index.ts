import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";
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
import { registerJobMatchFactRoutes } from "./routes/job-match-facts";
import { registerJobPositionAnalysisRoutes } from "./routes/job-position-analyses";
import { registerJobRoutes } from "./routes/jobs";
import { registerMessagePreviewRoutes } from "./routes/message-preview";
import { registerMessageRoutes } from "./routes/messages";
import { registerOnboardingRoutes } from "./routes/onboarding";
import { registerTestLabRoutes } from "./routes/test-lab";
import { registerUserSettingsRoutes } from "./routes/user-settings";
import { ImportSchema, SubmitSchema } from "./schemas";
import { authenticateAgentRunner } from "./services/agent-runners";
import { AgentTaskError } from "./services/agent-tasks/contracts";
import { ApplicationBundleError } from "./services/application-bundle-model";
import {
  DraftMessageFoundationRequiredError,
  DraftMutationError,
  DraftProfileRequiredError,
  importJobs,
} from "./services/application-drafts";
import { runCampaignMatchingPass } from "./services/campaign-matching";
import { runCampaignScheduler } from "./services/campaign-scheduler";
import { CampaignError } from "./services/campaigns";
import { CountryMarketError } from "./services/country-markets";
import { DocumentConversionError } from "./services/document-text";
import { EmailAttemptError } from "./services/email-attempts";
import { GmailIntegrationError } from "./services/gmail-errors";
import { renewExpiringGmailWatches } from "./services/gmail-integration";
import { JobAnalysisRecordError } from "./services/job-analysis-records";
import { approveAndSubmitApplication } from "./services/job-submission";
import {
  fetchExchangeRates,
  searchLocations,
  searchUniversities,
} from "./services/lookups";
import { ResumeUploadError } from "./services/profile-imports";
import { TestLabError } from "./services/test-lab/errors";

const app: JobKitApp = new OpenAPIHono<{
  Bindings: AppEnv;
  Variables: { agentRunner: AgentRunnerContext | null; user: AuthUser };
}>();
const jsonMessage = z.object({
  message: z.string().optional(),
  ok: z.boolean(),
});
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
  if (error instanceof ResumeUploadError) {
    return c.json({ message: error.message, ok: false }, error.status);
  }
  if (error instanceof DocumentConversionError) {
    return c.json({ message: error.message, ok: false }, 422);
  }
  if (error instanceof DraftProfileRequiredError) {
    return c.json({ message: error.message, ok: false }, 409);
  }
  if (error instanceof DraftMessageFoundationRequiredError) {
    return c.json({ message: error.message, ok: false }, 409);
  }
  if (error instanceof DraftMutationError) {
    return c.json({ message: error.message, ok: false }, error.status);
  }
  if (error instanceof EmailAttemptError) {
    return c.json({ message: error.message, ok: false }, error.status);
  }
  if (error instanceof OutboundRecipientClaimError) {
    return c.json({ message: error.message, ok: false }, 409);
  }
  if (error instanceof ApplicationBundleError) {
    return c.json({ message: error.message, ok: false }, error.status);
  }
  if (error instanceof GmailIntegrationError) {
    return c.json({ message: error.message, ok: false }, error.status);
  }
  if (error instanceof OnboardingIncompleteError) {
    return c.json({ message: error.message, ok: false }, 409);
  }
  if (error instanceof CountryMarketError) {
    return c.json({ message: error.message, ok: false }, error.status);
  }
  if (error instanceof CampaignError) {
    return c.json({ message: error.message, ok: false }, error.status);
  }
  if (error instanceof AgentTaskError) {
    return c.json({ message: error.message, ok: false }, error.status);
  }
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
  if (error instanceof TestLabError) {
    return c.json({ message: error.message, ok: false }, error.status);
  }
  return c.json({ message: "Internal server error", ok: false }, 500);
});

app.get("/api/health", (c) => c.json({ ok: true }));

app.on(["GET", "POST"], "/api/auth/*", (c) =>
  createAuth(c.env, c.req.raw).handler(c.req.raw)
);

const AGENT_PAIRING_EXCHANGE_PATH = "/api/agent-runner-pairings/exchange";
const AGENT_TASK_RESULT_PATH = /^\/api\/agent-tasks\/[^/]+\/(complete|fail)$/u;
const AGENT_TASK_ARTIFACT_PATH =
  /^\/api\/agent-tasks\/[^/]+\/artifacts\/[^/]+$/u;
const AGENT_TASK_CLAIM_PATH = "/api/agent-tasks/claim";

function runnerRequestAllowed(method: string, path: string) {
  if (method === "GET") {
    return AGENT_TASK_ARTIFACT_PATH.test(path);
  }
  return (
    method === "POST" &&
    (path === AGENT_TASK_CLAIM_PATH || AGENT_TASK_RESULT_PATH.test(path))
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
  const session = await createAuth(c.env, c.req.raw).api.getSession({
    headers: c.req.raw.headers,
  });
  if (!session) {
    return c.json({ message: "Authentication required", ok: false }, 401);
  }
  c.set("user", {
    email: session.user.email,
    id: session.user.id,
    name: session.user.name,
  });
  c.set("agentRunner", null);
  await next();
});

registerAgentRunnerRoutes(app);
registerOnboardingRoutes(app);
registerApplicationBundleRoutes(app);
registerApplicationDraftRoutes(app);
registerCampaignRoutes(app);
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

app.get("/api/fx", async (c) => c.json(await fetchExchangeRates()));

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

export default {
  fetch: app.fetch,
  scheduled(
    _controller: ScheduledController,
    env: AppEnv,
    ctx: ExecutionContext
  ) {
    ctx.waitUntil(
      Promise.all([
        renewExpiringGmailWatches(env),
        runCampaignMatchingPass(env.DB),
        runCampaignScheduler(env),
      ]).then(([gmail, matching, campaigns]) => {
        console.log(
          JSON.stringify({
            campaigns,
            event: "scheduled_maintenance",
            gmail,
            matching,
          })
        );
      })
    );
  },
};
