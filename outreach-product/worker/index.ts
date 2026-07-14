import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";
import { fallbackDraft, reviseWithModel } from "./drafts";
import type { AppEnv } from "./env";
import { recordJobEvent } from "./repositories/job-events";
import { compensationFromRow, upsertJob } from "./repositories/jobs";
import {
  readPreferences,
  readProfile,
  writePreferences,
  writeProfile,
} from "./repositories/user-settings";
import {
  ImportSchema,
  JobImportSchema,
  ReviseSchema,
  SubmitSchema,
} from "./schemas";
import { approveAndSubmitApplication } from "./services/job-submission";
import {
  fetchExchangeRates,
  searchLocations,
  searchUniversities,
} from "./services/lookups";

const app = new OpenAPIHono<{ Bindings: AppEnv }>();
const jsonMessage = z.object({
  message: z.string().optional(),
  ok: z.boolean(),
});
const now = () => new Date().toISOString();
const uid = () => crypto.randomUUID();

app.onError((error, c) => {
  if (error instanceof z.ZodError) {
    return c.json(
      { message: "Request did not match the expected schema", ok: false },
      400
    );
  }
  console.error(
    JSON.stringify({
      event: "request_error",
      message: error.message,
      path: c.req.path,
    })
  );
  return c.json({ message: error.message, ok: false }, 500);
});

app.get("/api/health", (c) => c.json({ ok: true }));

app.get("/api/fx", async (c) => c.json(await fetchExchangeRates()));

app.get("/api/universities", async (c) => {
  const query = (c.req.query("q") ?? "").trim().slice(0, 100);
  const country = (c.req.query("country") ?? "").trim().slice(0, 100);
  if (query.length < 2) {
    return c.json({ universities: [] });
  }
  return c.json({ universities: await searchUniversities(query, country) });
});

app.get("/api/locations", async (c) => {
  const query = (c.req.query("q") ?? "").trim().slice(0, 180);
  if (query.length < 2) {
    return c.json({ locations: [] });
  }

  return c.json({
    locations: await searchLocations(query, c.env.MAPBOX_ACCESS_TOKEN),
  });
});

app.post("/api/drafts/regenerate", async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT * FROM jobs WHERE status IN ('new','review')"
  ).all();
  let regenerated = 0;
  for (const row of rows.results) {
    const job = toJobImport(row);
    const latest = await c.env.DB.prepare(
      "SELECT version FROM application_drafts WHERE job_id=? ORDER BY version DESC LIMIT 1"
    )
      .bind(job.id)
      .first<{ version: number }>();
    const draft = fallbackDraft(job);
    await c.env.DB.prepare(
      "INSERT INTO application_drafts (id,job_id,version,message,change_summary,created_at) VALUES (?,?,?,?,?,?)"
    )
      .bind(
        uid(),
        job.id,
        (latest?.version ?? 0) + 1,
        draft.message,
        draft.summary,
        now()
      )
      .run();
    await c.env.DB.prepare(
      "UPDATE jobs SET status='review',updated_at=? WHERE id=?"
    )
      .bind(now(), job.id)
      .run();
    regenerated += 1;
  }
  return c.json({ message: `Regenerated ${regenerated} drafts`, ok: true });
});

app.openapi(
  createRoute({
    method: "post",
    path: "/api/import",
    request: {
      body: { content: { "application/json": { schema: ImportSchema } } },
    },
    responses: {
      200: {
        content: { "application/json": { schema: jsonMessage } },
        description: "Imported jobs",
      },
    },
  }),
  async (c) => {
    const { jobs } = c.req.valid("json");
    for (const job of jobs) {
      const timestamp = now();
      await upsertJob(c.env.DB, job, timestamp);
      const existing = await c.env.DB.prepare(
        "SELECT id FROM application_drafts WHERE job_id=? ORDER BY version DESC LIMIT 1"
      )
        .bind(job.id)
        .first();
      if (!existing) {
        const draft = fallbackDraft(job);
        await c.env.DB.prepare(
          "INSERT INTO application_drafts (id,job_id,version,message,change_summary,created_at) VALUES (?,?,?,?,?,?)"
        )
          .bind(uid(), job.id, 1, draft.message, draft.summary, timestamp)
          .run();
        await recordJobEvent(
          c.env.DB,
          job.id,
          "draft_generated",
          "Automatic tailored draft created"
        );
      }
    }
    return c.json({ message: `Imported ${jobs.length} jobs`, ok: true });
  }
);

app.get("/api/jobs", async (c) => {
  const rows =
    await c.env.DB.prepare(`SELECT j.*,d.id draft_id,d.version,d.message,d.change_summary,d.status draft_status FROM jobs j
    LEFT JOIN application_drafts d ON d.id=(SELECT id FROM application_drafts WHERE job_id=j.id ORDER BY version DESC LIMIT 1)
    ORDER BY j.priority DESC, CASE j.status WHEN 'new' THEN 0 WHEN 'review' THEN 1 WHEN 'approved' THEN 2 WHEN 'applied' THEN 4 ELSE 3 END, j.updated_at DESC`).all();
  return c.json({ jobs: rows.results.map(toReviewJob) });
});

app.get("/api/profile", async (c) => {
  const result = await readProfile(c.env.DB);
  return c.json({
    profile: result.value,
    updatedAt: result.updatedAt,
  });
});

app.put("/api/profile", async (c) => {
  await writeProfile(c.env.DB, await c.req.json());
  return c.json({ message: "Profile saved", ok: true });
});

app.get("/api/preferences", async (c) => {
  const result = await readPreferences(c.env.DB);
  return c.json({
    preferences: result.value,
    updatedAt: result.updatedAt,
  });
});

app.put("/api/preferences", async (c) => {
  await writePreferences(c.env.DB, await c.req.json());
  return c.json({ message: "Preferences saved", ok: true });
});

app.get("/api/documents", async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT id,category,filename,content_type,size_bytes,is_default,created_at FROM user_documents ORDER BY category,created_at DESC"
  ).all();
  return c.json({ documents: rows.results });
});

app.put("/api/documents", async (c) => {
  const length = Number(c.req.header("content-length") ?? 0);
  if (!(length > 0 && length <= 10 * 1024 * 1024)) {
    return c.json(
      { message: "Files must be between 1 byte and 10 MB", ok: false },
      413
    );
  }
  const filename = safeFilename(
    decodeURIComponent(c.req.header("x-jobkit-filename") ?? "document")
  );
  const category = (c.req.header("x-jobkit-category") ?? "other").slice(0, 40);
  const contentType =
    c.req.header("content-type") ?? "application/octet-stream";
  const allowed = new Set([
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "image/jpeg",
    "image/png",
  ]);
  if (!allowed.has(contentType)) {
    return c.json(
      { message: "Use PDF, DOCX, JPG, or PNG files", ok: false },
      415
    );
  }
  if (!c.req.raw.body) {
    return c.json({ message: "File body required", ok: false }, 400);
  }
  const id = uid();
  const objectKey = `owner/${id}/${filename}`;
  await c.env.DOCUMENTS.put(objectKey, c.req.raw.body, {
    httpMetadata: {
      contentDisposition: `inline; filename="${filename}"`,
      contentType,
    },
  });
  try {
    await c.env.DB.prepare(
      "INSERT INTO user_documents (id,category,filename,object_key,content_type,size_bytes,created_at) VALUES (?,?,?,?,?,?,?)"
    )
      .bind(id, category, filename, objectKey, contentType, length, now())
      .run();
  } catch (error) {
    await c.env.DOCUMENTS.delete(objectKey);
    throw error;
  }
  return c.json({ message: "Document uploaded", ok: true });
});

app.get("/api/documents/:id", async (c) => {
  const row = await c.env.DB.prepare(
    "SELECT filename,object_key,content_type FROM user_documents WHERE id=?"
  )
    .bind(c.req.param("id"))
    .first<{ filename: string; object_key: string; content_type: string }>();
  if (!row) {
    return c.json({ message: "Document not found", ok: false }, 404);
  }
  const object = await c.env.DOCUMENTS.get(row.object_key);
  if (!object?.body) {
    return c.json({ message: "Document data not found", ok: false }, 404);
  }
  const headers = new Headers({
    "cache-control": "private, no-store",
    "content-disposition": `inline; filename="${safeFilename(row.filename)}"`,
    "content-type": row.content_type,
    etag: object.httpEtag,
  });
  return new Response(object.body, { headers });
});

app.delete("/api/documents/:id", async (c) => {
  const row = await c.env.DB.prepare(
    "SELECT object_key FROM user_documents WHERE id=?"
  )
    .bind(c.req.param("id"))
    .first<{ object_key: string }>();
  if (!row) {
    return c.json({ message: "Document not found", ok: false }, 404);
  }
  await c.env.DOCUMENTS.delete(row.object_key);
  await c.env.DB.prepare("DELETE FROM user_documents WHERE id=?")
    .bind(c.req.param("id"))
    .run();
  return c.json({ message: "Document deleted", ok: true });
});

app.openapi(
  createRoute({
    method: "post",
    path: "/api/jobs/{id}/revise",
    request: {
      body: { content: { "application/json": { schema: ReviseSchema } } },
      params: z.object({ id: z.string() }),
    },
    responses: {
      200: {
        content: { "application/json": { schema: jsonMessage } },
        description: "Revised",
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    const { instruction } = c.req.valid("json");
    const row = await currentJobAndDraft(c.env.DB, id);
    const revised = await reviseWithModel(
      c.env,
      row.job,
      row.message,
      instruction
    );
    const draftId = uid();
    await c.env.DB.batch([
      c.env.DB.prepare(
        "UPDATE application_drafts SET status='superseded' WHERE job_id=? AND status='draft'"
      ).bind(id),
      c.env.DB.prepare(
        "INSERT INTO application_drafts (id,job_id,version,message,change_summary,revision_instruction,created_at) VALUES (?,?,?,?,?,?,?)"
      ).bind(
        draftId,
        id,
        row.version + 1,
        revised.message,
        revised.summary,
        instruction,
        now()
      ),
      c.env.DB.prepare(
        "UPDATE jobs SET status='review',updated_at=? WHERE id=?"
      ).bind(now(), id),
    ]);
    await recordJobEvent(
      c.env.DB,
      id,
      "draft_revised",
      revised.summary,
      draftId
    );
    return c.json({ message: revised.message, ok: true });
  }
);

app.openapi(
  createRoute({
    method: "post",
    path: "/api/jobs/{id}/submit",
    request: {
      body: { content: { "application/json": { schema: SubmitSchema } } },
      params: z.object({ id: z.string() }),
    },
    responses: {
      200: {
        content: { "application/json": { schema: jsonMessage } },
        description: "Application submitted",
      },
      409: {
        content: { "application/json": { schema: jsonMessage } },
        description: "Draft or submission conflict",
      },
      502: {
        content: { "application/json": { schema: jsonMessage } },
        description: "Application board rejected the submission",
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    const { draftId } = c.req.valid("json");
    const outcome = await approveAndSubmitApplication(c.env, id, draftId);
    const body = { message: outcome.message, ok: outcome.status === 200 };
    if (outcome.status === 409) {
      return c.json(body, 409);
    }
    if (outcome.status === 502) {
      return c.json(body, 502);
    }
    return c.json(body, 200);
  }
);

app.doc("/openapi.json", {
  info: { title: "JobKit Outreach API", version: "0.1.0" },
  openapi: "3.1.0",
});

async function currentJobAndDraft(db: D1Database, id: string) {
  const row = await db
    .prepare(
      "SELECT j.*,d.version,d.message FROM jobs j JOIN application_drafts d ON d.job_id=j.id WHERE j.id=? ORDER BY d.version DESC LIMIT 1"
    )
    .bind(id)
    .first<Record<string, unknown>>();
  if (!row) {
    throw new Error("Job or draft not found");
  }
  const job = JobImportSchema.parse({
    applyUrl: row.apply_url,
    board: row.board,
    company: row.company,
    country: row.country,
    description: row.description,
    employerId: row.employer_id,
    id: row.id,
    location: row.location,
    priority: row.priority,
    salary: row.salary,
    sourceUrl: row.source_url,
    title: row.title,
  });
  return { job, message: String(row.message), version: Number(row.version) };
}

function toReviewJob(row: Record<string, unknown>) {
  return {
    applyUrl: String(row.apply_url),
    company: String(row.company),
    compensation: compensationFromRow(row),
    country: String(row.country),
    description: String(row.description),
    draft: row.draft_id
      ? {
          changeSummary: String(row.change_summary),
          id: String(row.draft_id),
          message: String(row.message),
          status: String(row.draft_status),
          version: Number(row.version),
        }
      : null,
    id: String(row.id),
    location: String(row.location),
    priority: Number(row.priority),
    sourceUrl: String(row.source_url),
    status: String(row.status),
    title: String(row.title),
  };
}

export default app;

function toJobImport(
  row: Record<string, unknown>
): z.infer<typeof JobImportSchema> {
  return JobImportSchema.parse({
    applyUrl: row.apply_url,
    board: row.board,
    company: row.company,
    country: row.country,
    description: row.description,
    employerId: row.employer_id,
    id: row.id,
    location: row.location,
    priority: row.priority,
    salary: row.salary,
    sourceUrl: row.source_url,
    title: row.title,
  });
}

function safeFilename(value: string) {
  return value
    .replace(/[^a-z0-9._ -]/gi, "_")
    .replace(/\s+/g, " ")
    .slice(0, 120);
}
