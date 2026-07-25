import { z } from "zod";
import type { JobKitApp } from "../app-types";
import { sendApplicationEmailWithGmail } from "../services/gmail-integration";

const EmailSendSchema = z
  .object({
    draftId: z.string().min(1),
    routeId: z.string().min(1),
  })
  .strict();

export function registerEmailAttemptRoutes(app: JobKitApp) {
  app.post("/api/jobs/:jobId/email-send", async (c) => {
    const { draftId, routeId } = EmailSendSchema.parse(await c.req.json());
    return c.json(
      await sendApplicationEmailWithGmail(
        c.env,
        c.get("user").id,
        c.req.param("jobId"),
        draftId,
        routeId
      )
    );
  });
}
