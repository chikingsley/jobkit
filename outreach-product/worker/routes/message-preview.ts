import { z } from "zod";
import type { JobKitApp } from "../app-types";
import {
  readMessagePreviews,
  reviseMessagePreview,
} from "../services/message-preview";

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
    const revised = await reviseMessagePreview(
      c.env,
      c.get("user").id,
      input.key,
      input.currentMessage,
      input.instruction
    );
    return c.json({
      changeSummary: revised.summary,
      message: revised.message,
      modelId: revised.modelId,
      ok: true,
      previousMessage: input.currentMessage,
      provider: revised.provider,
    });
  });
}
