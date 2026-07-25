import { z } from "zod";
import { sendApplicationEmailWithGmail } from "../../src/pipeline/06_deliver/gmail-integration";
import type { JobKitApp } from "../app-types";

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
