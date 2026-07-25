import { createRoute } from "@hono/zod-openapi";
import { z } from "zod";
import {
  queueJobDraftRevision,
  saveManualJobDraft,
  undoJobDraft,
} from "../../src/pipeline/04_compose/application-drafts";
import type { JobKitApp } from "../app-types";
import { ManualDraftSchema, ReviseSchema } from "../schemas";

const DraftMutationResponseSchema = z.object({
  draft: z.object({
    changeSummary: z.string(),
    createdAt: z.string(),
    id: z.string(),
    message: z.string(),
    previousMessage: z.string(),
    revisionSource: z.enum(["ai_revision", "manual_edit", "undo"]),
    status: z.literal("draft"),
    version: z.number().int(),
  }),
  notice: z.string(),
  ok: z.literal(true),
});
const ErrorResponseSchema = z.object({
  message: z.string(),
  ok: z.literal(false),
});
const DraftTaskQueuedResponseSchema = z.object({
  notice: z.string(),
  ok: z.literal(true),
  taskRequest: z.object({ id: z.string(), status: z.string() }),
});
const JobIdSchema = z.object({ id: z.string() });

export function registerApplicationDraftRoutes(app: JobKitApp) {
  app.openapi(
    createRoute({
      method: "post",
      path: "/api/jobs/{id}/revise",
      request: {
        body: { content: { "application/json": { schema: ReviseSchema } } },
        params: JobIdSchema,
      },
      responses: draftMutationResponses("Revised with the active model"),
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      const { instruction } = c.req.valid("json");
      const taskRequest = await queueJobDraftRevision(
        c.env,
        c.get("user").id,
        id,
        instruction
      );
      return c.json(
        {
          notice: "Revision queued for your Codex agent",
          ok: true as const,
          taskRequest,
        },
        202
      );
    }
  );

  app.openapi(
    createRoute({
      method: "put",
      path: "/api/jobs/{id}/draft",
      request: {
        body: {
          content: { "application/json": { schema: ManualDraftSchema } },
        },
        params: JobIdSchema,
      },
      responses: draftMutationResponses("Saved as a manual edit"),
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      const { message } = c.req.valid("json");
      const result = await saveManualJobDraft(
        c.env,
        c.get("user").id,
        id,
        message
      );
      return c.json(
        {
          ...result,
          notice: "Manual edit saved",
          ok: true as const,
        },
        200
      );
    }
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/jobs/{id}/undo",
      request: { params: JobIdSchema },
      responses: draftMutationResponses("Restored the preceding draft"),
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      const result = await undoJobDraft(c.env, c.get("user").id, id);
      return c.json(
        {
          ...result,
          notice: "Last draft change undone",
          ok: true as const,
        },
        200
      );
    }
  );
}

function draftMutationResponses(description: string) {
  return {
    200: {
      content: { "application/json": { schema: DraftMutationResponseSchema } },
      description,
    },
    202: {
      content: {
        "application/json": { schema: DraftTaskQueuedResponseSchema },
      },
      description: "Queued for the paired Codex agent",
    },
    409: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "Draft conflict",
    },
    422: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "Draft policy violation",
    },
    502: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "Draft model failed",
    },
  } as const;
}
