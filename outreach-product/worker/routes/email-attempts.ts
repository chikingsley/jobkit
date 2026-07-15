import { z } from "zod";
import type { JobKitApp } from "../app-types";
import {
  claimEmailAttempt,
  createApprovedEmailAttempt,
  type EmailAttemptStatus,
  listEmailAttempts,
  recordFailedEmailAttempt,
  recordGmailDraft,
  recordGmailSent,
  recordUncertainEmailAttempt,
  reserveGmailSend,
} from "../services/email-attempts";

const AttemptSelectionSchema = z
  .object({
    draftId: z.string().min(1),
    routeId: z.string().min(1),
  })
  .strict();

const GmailDraftSchema = z
  .object({
    gmailDraftId: z.string().min(1).max(500),
    gmailMessageId: z.string().min(1).max(500),
  })
  .strict();

const GmailSendingSchema = z
  .object({ gmailDraftId: z.string().min(1).max(500) })
  .strict();

const GmailSentSchema = z
  .object({
    gmailDraftId: z.string().min(1).max(500),
    gmailMessageId: z.string().min(1).max(500),
    gmailThreadId: z.string().min(1).max(500),
  })
  .strict();

const FailureSchema = z
  .object({
    error: z.string().min(1).max(1000),
    stage: z.string().min(1).max(100),
  })
  .strict();

const UncertainSchema = FailureSchema.extend({
  gmailMessageId: z.string().max(500).optional(),
  gmailThreadId: z.string().max(500).optional(),
}).strict();

const statusValues = [
  "approved",
  "claimed",
  "drafted",
  "sending",
  "sent",
  "failed",
  "uncertain",
] as const satisfies readonly EmailAttemptStatus[];
const StatusQuerySchema = z.enum([...statusValues, "all", "attention"]);
const allStatuses: EmailAttemptStatus[] = [...statusValues];
const attentionStatuses = allStatuses.filter((status) => status !== "sent");

export function registerEmailAttemptRoutes(app: JobKitApp) {
  app.post("/api/jobs/:jobId/email-attempts", async (c) => {
    const { draftId, routeId } = AttemptSelectionSchema.parse(
      await c.req.json()
    );
    const attempt = await createApprovedEmailAttempt(
      c.env,
      c.get("user").id,
      c.req.param("jobId"),
      draftId,
      routeId
    );
    return c.json({ attempt, ok: true });
  });

  app.get("/api/email-attempts", async (c) => {
    const statuses = requestedStatuses(c.req.query("status"));
    const attempts = await listEmailAttempts(
      c.env.DB,
      c.get("user").id,
      statuses
    );
    return c.json({ attempts, ok: true });
  });

  app.post("/api/email-attempts/:attemptId/claim", async (c) => {
    const payload = await claimEmailAttempt(
      c.env,
      c.get("user").id,
      c.req.param("attemptId")
    );
    return c.json({ ...payload, ok: true });
  });

  app.post("/api/email-attempts/:attemptId/drafted", async (c) => {
    const { gmailDraftId, gmailMessageId } = GmailDraftSchema.parse(
      await c.req.json()
    );
    const attempt = await recordGmailDraft(
      c.env.DB,
      c.get("user").id,
      c.req.param("attemptId"),
      gmailDraftId,
      gmailMessageId
    );
    return c.json({ attempt, ok: true });
  });

  app.post("/api/email-attempts/:attemptId/sending", async (c) => {
    const { gmailDraftId } = GmailSendingSchema.parse(await c.req.json());
    const attempt = await reserveGmailSend(
      c.env.DB,
      c.get("user").id,
      c.req.param("attemptId"),
      gmailDraftId
    );
    return c.json({ attempt, ok: true });
  });

  app.post("/api/email-attempts/:attemptId/sent", async (c) => {
    const { gmailDraftId, gmailMessageId, gmailThreadId } =
      GmailSentSchema.parse(await c.req.json());
    const attempt = await recordGmailSent(
      c.env.DB,
      c.get("user").id,
      c.req.param("attemptId"),
      gmailDraftId,
      gmailMessageId,
      gmailThreadId
    );
    return c.json({ attempt, ok: true });
  });

  app.post("/api/email-attempts/:attemptId/failed", async (c) => {
    const { error, stage } = FailureSchema.parse(await c.req.json());
    const attempt = await recordFailedEmailAttempt(
      c.env.DB,
      c.get("user").id,
      c.req.param("attemptId"),
      stage,
      error
    );
    return c.json({ attempt, ok: true });
  });

  app.post("/api/email-attempts/:attemptId/uncertain", async (c) => {
    const { error, gmailMessageId, gmailThreadId, stage } =
      UncertainSchema.parse(await c.req.json());
    const attempt = await recordUncertainEmailAttempt(
      c.env.DB,
      c.get("user").id,
      c.req.param("attemptId"),
      stage,
      error,
      gmailMessageId,
      gmailThreadId
    );
    return c.json({ attempt, ok: true });
  });
}

function requestedStatuses(value: string | undefined): EmailAttemptStatus[] {
  const status = StatusQuerySchema.parse(value ?? "attention");
  if (status === "attention") {
    return attentionStatuses;
  }
  if (status === "all") {
    return allStatuses;
  }
  return [status];
}
