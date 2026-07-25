import { z } from "zod";
import type { JobKitApp } from "../app-types";
import {
  listCampaignDeliveryAuthorizationEvents,
  readCampaignDeliveryAuthorization,
  writeCampaignDeliveryAuthorization,
} from "../repositories/campaign-delivery-authorization";

const DeliveryAuthorizationSchema = z
  .object({
    enabled: z.boolean(),
    reason: z.string().trim().min(1).max(1000),
    scope: z.enum(["campaigns"]),
  })
  .strict();

export function registerDeliveryAuthorizationRoutes(app: JobKitApp) {
  app.use("/api/operator/delivery-authorization", async (c, next) => {
    if (c.get("user").role !== "operator") {
      return c.json(
        { message: "Operator access is required", ok: false as const },
        403
      );
    }
    await next();
  });

  app.get("/api/operator/delivery-authorization", async (c) => {
    const user = c.get("user");
    const [authorization, history] = await Promise.all([
      readCampaignDeliveryAuthorization(c.env.DB, user.id),
      listCampaignDeliveryAuthorizationEvents(c.env.DB, user.id),
    ]);
    return c.json({ authorization, history, ok: true as const });
  });

  app.post("/api/operator/delivery-authorization", async (c) => {
    const user = c.get("user");
    const input = DeliveryAuthorizationSchema.parse(await c.req.json());
    const authorization = await writeCampaignDeliveryAuthorization(c.env.DB, {
      actingUserId: user.id,
      enabled: input.enabled,
      reason: input.reason,
      scope: input.scope,
      userId: user.id,
    });
    return c.json({
      authorization,
      message: input.enabled
        ? "Live campaign delivery authorized"
        : "Live campaign delivery locked",
      ok: true as const,
    });
  });
}
