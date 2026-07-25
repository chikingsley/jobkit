import { z } from "zod";
import {
  queueMessagePreviewRevision,
  readMessagePreviews,
} from "../../src/pipeline/04_compose/message-preview";
import type { JobKitApp } from "../app-types";

const PreviewRevisionSchema = z
  .object({
    currentMessage: z.string().min(1).max(5000),
    instruction: z.string().min(1).max(1000),
    key: z.string().min(1).max(80),
  })
  .strict();

export function registerMessagePreviewRoutes(app: JobKitApp) {
  app.get("/api/message-preview", async (c) =>
    c.json({ previews: await readMessagePreviews(c.env, c.get("user").id) })
  );

  app.post("/api/message-preview/revise", async (c) => {
    const input = PreviewRevisionSchema.parse(await c.req.json());
    const taskRequest = await queueMessagePreviewRevision(
      c.env,
      c.get("user").id,
      {
        currentMessage: input.currentMessage,
        instruction: input.instruction,
        kind: "message_preview",
        mode: "revise",
        previewKey: input.key,
      }
    );
    return c.json(
      {
        message: "Preview revision queued for your Codex agent",
        ok: true,
        taskRequest,
      },
      202
    );
  });
}
