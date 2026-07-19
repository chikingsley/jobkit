import { z } from "zod";
import type { JobKitApp } from "../app-types";
import { listAneslPositions } from "../services/application-bundle-candidates";
import { sendApplicationBundleTestEmail } from "../services/application-bundle-test-email";
import { listAneslApplicationSets } from "../services/application-bundle-view";
import {
  cancelAneslApplicationSet,
  createAneslApplicationSet,
  reviseAneslApplicationSet,
  saveManualAneslApplicationSetDraft,
  undoAneslApplicationSetDraft,
} from "../services/application-bundles";
import { sendApplicationBundleEmailWithGmail } from "../services/gmail-integration";

const CreateSetSchema = z
  .object({ jobIds: z.array(z.string().min(1)).min(1).max(5) })
  .strict();
const DraftSchema = z
  .object({ message: z.string().min(100).max(5000) })
  .strict();
const ReviseSchema = z
  .object({ instruction: z.string().min(1).max(1000) })
  .strict();
const SendSchema = z.object({ draftId: z.string().min(1) }).strict();
const TestSendSchema = z.object({ recipient: z.email() }).strict();

export function registerApplicationBundleRoutes(app: JobKitApp) {
  app.get("/api/anesl/positions", async (c) => {
    const limit = Number.parseInt(c.req.query("limit") ?? "100", 10);
    const offset = Number.parseInt(c.req.query("offset") ?? "0", 10);
    return c.json(
      await listAneslPositions(c.env.DB, c.get("user").id, {
        limit: Number.isFinite(limit) ? limit : 100,
        offset: Number.isFinite(offset) ? offset : 0,
        query: c.req.query("q") ?? "",
      })
    );
  });

  app.get("/api/anesl/application-sets", async (c) =>
    c.json({
      applicationSets: await listAneslApplicationSets(
        c.env.DB,
        c.get("user").id
      ),
      ok: true as const,
    })
  );

  app.post("/api/anesl/application-sets", async (c) => {
    const { jobIds } = CreateSetSchema.parse(await c.req.json());
    const created = await createAneslApplicationSet(
      c.env,
      c.get("user").id,
      jobIds
    );
    return c.json(
      {
        ...created,
        message: "ANESL application set queued for Codex drafting",
        ok: true as const,
      },
      202
    );
  });

  app.put("/api/anesl/application-sets/:bundleId/draft", async (c) => {
    const { message } = DraftSchema.parse(await c.req.json());
    return c.json({
      applicationSet: await saveManualAneslApplicationSetDraft(
        c.env,
        c.get("user").id,
        c.req.param("bundleId"),
        message
      ),
      notice: "Manual edit saved",
      ok: true as const,
    });
  });

  app.post("/api/anesl/application-sets/:bundleId/revise", async (c) => {
    const { instruction } = ReviseSchema.parse(await c.req.json());
    const queued = await reviseAneslApplicationSet(
      c.env,
      c.get("user").id,
      c.req.param("bundleId"),
      instruction
    );
    return c.json(
      {
        ...queued,
        notice: "Revision queued for Codex",
        ok: true as const,
      },
      202
    );
  });

  app.post("/api/anesl/application-sets/:bundleId/undo", async (c) =>
    c.json({
      applicationSet: await undoAneslApplicationSetDraft(
        c.env,
        c.get("user").id,
        c.req.param("bundleId")
      ),
      notice: "Last draft change undone",
      ok: true as const,
    })
  );

  app.post("/api/anesl/application-sets/:bundleId/test-send", async (c) => {
    const { recipient } = TestSendSchema.parse(await c.req.json());
    return c.json(
      await sendApplicationBundleTestEmail(
        c.env,
        c.get("user").id,
        c.req.param("bundleId"),
        recipient.toLowerCase()
      )
    );
  });

  app.post("/api/anesl/application-sets/:bundleId/send", async (c) => {
    const { draftId } = SendSchema.parse(await c.req.json());
    return c.json(
      await sendApplicationBundleEmailWithGmail(
        c.env,
        c.get("user").id,
        c.req.param("bundleId"),
        draftId
      )
    );
  });

  app.post("/api/anesl/application-sets/:bundleId/cancel", async (c) =>
    c.json({
      applicationSet: await cancelAneslApplicationSet(
        c.env.DB,
        c.get("user").id,
        c.req.param("bundleId")
      ),
      message: "ANESL application set cancelled",
      ok: true as const,
    })
  );
}
