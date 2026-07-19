import {
  DocumentBenchmarkRunSchema,
  TestDeliveryAllowlistSchema,
  TestDeliveryCaptureSchema,
  TestDeliveryEventSchema,
  TestLabPreferenceSchema,
  TestLabRunRequestSchema,
} from "../../src/features/test-lab/schema";
import type { JobKitApp } from "../app-types";
import {
  allowTestDeliveryAddress,
  createTestDeliveryCapture,
  createTestDeliveryEvent,
  listTestDelivery,
  readTestDeliveryMime,
  removeTestDeliveryAddress,
} from "../services/test-lab/delivery";
import {
  listTestLab,
  readTestLabRun,
  replayTestLabRun,
  resetTestLab,
  saveTestLabPreference,
  startDocumentBenchmarkRun,
  startTestLabRun,
} from "../services/test-lab/runs";

export function registerTestLabRoutes(app: JobKitApp) {
  app.get("/api/test-lab", async (c) =>
    c.json({
      ...(await listTestLab(c.env, c.get("user").id)),
      ok: true as const,
    })
  );

  app.get("/api/test-lab/runs/:runId", async (c) => {
    const run = await readTestLabRun(
      c.env.DB,
      c.get("user").id,
      c.req.param("runId")
    );
    if (!run) {
      return c.json({ message: "Test Lab run was not found", ok: false }, 404);
    }
    return c.json({ ok: true, run });
  });

  app.post("/api/test-lab/runs", async (c) => {
    const input = TestLabRunRequestSchema.parse(await c.req.json());
    const run = await startTestLabRun(
      c.env,
      c.get("user").id,
      input.caseId,
      input.variant
    );
    const status = run.status === "completed" ? 200 : 202;
    return c.json(
      {
        message:
          status === 200
            ? "Test Lab run completed"
            : "Test Lab run queued for the paired Codex agent",
        ok: true as const,
        run,
      },
      status
    );
  });

  app.post("/api/test-lab/document-runs", async (c) => {
    const input = DocumentBenchmarkRunSchema.parse(await c.req.json());
    const run = await startDocumentBenchmarkRun(c.env, c.get("user").id, input);
    return c.json(
      {
        message:
          run.status === "queued"
            ? "Document OCR queued for the paired Codex agent"
            : "Document benchmark completed",
        ok: true as const,
        run,
      },
      run.status === "queued" ? 202 : 200
    );
  });

  app.post("/api/test-lab/runs/:runId/replay", async (c) => {
    const run = await replayTestLabRun(
      c.env,
      c.get("user").id,
      c.req.param("runId")
    );
    const status = run.status === "completed" ? 200 : 202;
    return c.json(
      {
        message:
          status === 200
            ? "Test Lab replay completed"
            : "Test Lab replay queued",
        ok: true as const,
        run,
      },
      status
    );
  });

  app.post("/api/test-lab/preferences", async (c) => {
    const input = TestLabPreferenceSchema.parse(await c.req.json());
    return c.json({
      message: "Test Lab preference recorded",
      ok: true as const,
      preference: await saveTestLabPreference(
        c.env.DB,
        c.get("user").id,
        input
      ),
    });
  });

  app.delete("/api/test-lab", async (c) =>
    c.json({
      message: "Test Lab run history reset",
      ok: true as const,
      result: await resetTestLab(c.env.DB, c.get("user").id),
    })
  );

  app.get("/api/test-lab/delivery", async (c) =>
    c.json({
      ...(await listTestDelivery(c.env.DB, c.get("user"))),
      ok: true as const,
    })
  );

  app.post("/api/test-lab/delivery/allowlist", async (c) => {
    const { email } = TestDeliveryAllowlistSchema.parse(await c.req.json());
    return c.json({
      address: await allowTestDeliveryAddress(c.env.DB, c.get("user"), email),
      message: "Test delivery address allowlisted",
      ok: true as const,
    });
  });

  app.delete("/api/test-lab/delivery/allowlist/:email", async (c) => {
    await removeTestDeliveryAddress(
      c.env.DB,
      c.get("user").id,
      decodeURIComponent(c.req.param("email"))
    );
    return c.json({
      message: "Test delivery address removed",
      ok: true as const,
    });
  });

  app.post("/api/test-lab/delivery/captures", async (c) => {
    const input = TestDeliveryCaptureSchema.parse(await c.req.json());
    return c.json({
      capture: await createTestDeliveryCapture(c.env, c.get("user"), input),
      message: "Exact MIME captured without external delivery",
      ok: true as const,
    });
  });

  app.get("/api/test-lab/delivery/captures/:captureId/mime", async (c) => {
    const object = await readTestDeliveryMime(
      c.env,
      c.get("user").id,
      c.req.param("captureId")
    );
    return new Response(object.body, {
      headers: {
        "cache-control": "private, no-store",
        "content-disposition": `attachment; filename="jobkit-test-${c.req.param("captureId")}.eml"`,
        "content-type": "message/rfc822",
        etag: object.httpEtag,
      },
    });
  });

  app.post("/api/test-lab/delivery/captures/:captureId/events", async (c) => {
    const input = TestDeliveryEventSchema.parse(await c.req.json());
    return c.json({
      event: await createTestDeliveryEvent(
        c.env.DB,
        c.get("user").id,
        c.req.param("captureId"),
        input
      ),
      message: "Provider event simulated",
      ok: true as const,
    });
  });
}
