import { z } from "zod";
import type { JobKitApp } from "../app-types";
import { PublicProjectionRunRequestSchema } from "../services/public-projection/contracts";
import { promoteProjectionCandidate } from "../services/public-projection/promotion";
import {
  createPublicProjectionRun,
  getPublicProjectionRun,
  PublicProjectionRunError,
} from "../services/public-projection/runs";

export function registerPublicProjectionRoutes(app: JobKitApp) {
  app.post("/api/operator/public-projection/runs", async (c) => {
    const user = c.get("user");
    requireOperator(user.role);
    const input = PublicProjectionRunRequestSchema.parse(await c.req.json());
    const run = await createPublicProjectionRun(c.env.DB, user.id, input);
    return c.json(
      { message: "Shadow projection run ready", ok: true, run },
      202
    );
  });

  app.get("/api/operator/public-projection/runs/:runId", async (c) => {
    requireOperator(c.get("user").role);
    const run = await getPublicProjectionRun(c.env.DB, c.req.param("runId"));
    if (!run) {
      throw new PublicProjectionRunError("Projection run was not found", 404);
    }
    return c.json({ ok: true, run });
  });

  app.post(
    "/api/operator/public-projection/runs/:runId/promotions",
    async (c) => {
      const user = c.get("user");
      requireOperator(user.role);
      const { allocationId } = z
        .object({ allocationId: z.string().min(1) })
        .strict()
        .parse(await c.req.json());
      const promotion = await promoteProjectionCandidate(c.env.DB, {
        allocationId,
        runId: c.req.param("runId"),
        userId: user.id,
      });
      return c.json(
        {
          message: promotion.created
            ? "Projection candidate promoted"
            : "Projection candidate promotion already exists",
          ok: true,
          promotion,
        },
        promotion.created ? 201 : 200
      );
    }
  );
}

function requireOperator(role: "member" | "operator") {
  if (role !== "operator") {
    throw new PublicProjectionRunError(
      "Operator access is required for public projection runs",
      403
    );
  }
}
