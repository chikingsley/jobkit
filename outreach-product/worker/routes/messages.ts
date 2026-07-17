import { z } from "zod";
import type { JobKitApp } from "../app-types";
import {
  getMessageThread,
  getThreadAttachment,
  listMessageThreads,
  MessageThreadError,
  markThreadRead,
  recordInboundMessage,
} from "../services/messages";

const InboundMessageSchema = z.object({
  bodyText: z.string().min(1).max(100_000),
  fromAddress: z.string().min(1).max(320),
  gmailMessageId: z.string().min(1).max(200),
  gmailThreadId: z.string().min(1).max(200),
  sentAt: z.string().min(1).max(40),
  subject: z.string().max(500).default(""),
  toAddress: z.string().max(320).default(""),
});

export function registerMessageRoutes(app: JobKitApp) {
  app.get("/api/messages", async (c) => {
    const threads = await listMessageThreads(c.env.DB, c.get("user").id);
    return c.json({ ok: true, threads });
  });

  app.get("/api/messages/threads/:threadId", async (c) => {
    try {
      const thread = await getMessageThread(
        c.env.DB,
        c.get("user").id,
        c.req.param("threadId")
      );
      return c.json({ ok: true, thread });
    } catch (error) {
      if (error instanceof MessageThreadError) {
        return c.json({ message: error.message, ok: false }, error.status);
      }
      throw error;
    }
  });

  // Written by the local Gmail bridge after it classifies a genuine inbound
  // reply (bounces and auto-replies are filtered bridge-side).
  app.post("/api/messages/inbound", async (c) => {
    const body = InboundMessageSchema.safeParse(await c.req.json());
    if (!body.success) {
      return c.json(
        {
          issues: z.treeifyError(body.error),
          message: "Invalid inbound message payload",
          ok: false,
        },
        400
      );
    }
    try {
      const result = await recordInboundMessage(
        c.env.DB,
        c.get("user").id,
        body.data
      );
      return c.json({ created: result.created, ok: true });
    } catch (error) {
      if (error instanceof MessageThreadError) {
        return c.json({ message: error.message, ok: false }, error.status);
      }
      throw error;
    }
  });

  app.post("/api/messages/threads/:threadId/read", async (c) => {
    const marked = await markThreadRead(
      c.env.DB,
      c.get("user").id,
      c.req.param("threadId")
    );
    return c.json({ marked, ok: true });
  });

  app.get("/api/messages/attachments/:attemptId/:position", async (c) => {
    const position = Number.parseInt(c.req.param("position"), 10);
    if (!(Number.isInteger(position) && position >= 0)) {
      return c.json({ message: "Invalid attachment position", ok: false }, 400);
    }
    try {
      return await getThreadAttachment(
        c.env,
        c.get("user").id,
        c.req.param("attemptId"),
        position
      );
    } catch (error) {
      if (error instanceof MessageThreadError) {
        return c.json({ message: error.message, ok: false }, error.status);
      }
      throw error;
    }
  });
}
