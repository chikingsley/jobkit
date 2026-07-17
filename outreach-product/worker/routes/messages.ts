import type { JobKitApp } from "../app-types";
import {
  getMessageThread,
  getThreadAttachment,
  listMessageThreads,
  MessageThreadError,
  markThreadRead,
} from "../services/messages";

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
