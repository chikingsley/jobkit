import { z } from "zod";
import type { JobKitApp } from "../app-types";
import {
  createFollowUpGmailDraft,
  sendFollowUpGmailDraft,
} from "../services/followups";
import {
  getMessageThread,
  getThreadAttachment,
  listMessageThreads,
  MessageThreadError,
  markThreadRead,
  writeThreadOutcome,
} from "../services/messages";

const MessageOutcomeInputSchema = z
  .object({
    note: z.string().max(1000).default(""),
    outcome: z
      .enum([
        "interested",
        "interview",
        "offer",
        "declined",
        "withdrawn",
        "bounced",
        "no_response",
      ])
      .nullable(),
  })
  .strict();

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

  app.post("/api/messages/threads/:threadId/read", async (c) => {
    const marked = await markThreadRead(
      c.env.DB,
      c.get("user").id,
      c.req.param("threadId")
    );
    return c.json({ marked, ok: true });
  });

  app.put("/api/messages/threads/:threadId/outcome", async (c) => {
    const input = MessageOutcomeInputSchema.parse(await c.req.json());
    const outcome = await writeThreadOutcome(
      c.env.DB,
      c.get("user").id,
      c.req.param("threadId"),
      input.outcome,
      input.note
    );
    return c.json({ message: "Conversation outcome saved", ok: true, outcome });
  });

  app.post("/api/messages/follow-ups/:followUpId/gmail-draft", async (c) => {
    const followUp = await createFollowUpGmailDraft(
      c.env,
      c.get("user").id,
      c.req.param("followUpId")
    );
    return c.json({
      followUp,
      message: "Follow-up draft created in Gmail",
      ok: true,
    });
  });

  app.post("/api/messages/follow-ups/:followUpId/send", async (c) => {
    const followUp = await sendFollowUpGmailDraft(
      c.env,
      c.get("user").id,
      c.req.param("followUpId")
    );
    return c.json({ followUp, message: "Follow-up sent", ok: true });
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
