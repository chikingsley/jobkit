import { z } from "zod";
import type { JobKitApp } from "../app-types";
import type { AppEnv } from "../env";
import {
  addDocumentToPacketVacancies,
  listDocumentPackets,
  setDefaultDocumentPacket,
} from "../repositories/document-packets";
import { listUserDocuments } from "../repositories/user-documents";

const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
const allowedContentTypes = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/jpeg",
  "image/png",
]);
const DefaultPacketSchema = z.object({ packetId: z.string().min(1) }).strict();

function validDocumentLength(length: number) {
  return length > 0 && length <= MAX_DOCUMENT_BYTES;
}

async function persistUploadedDocument(
  env: AppEnv,
  input: {
    body: ReadableStream<Uint8Array>;
    category: string;
    contentType: string;
    filename: string;
    length: number;
    userId: string;
  }
) {
  const id = crypto.randomUUID();
  const objectKey = `users/${input.userId}/${id}/${input.filename}`;
  const object = await env.DOCUMENTS.put(objectKey, input.body, {
    httpMetadata: {
      contentDisposition: `inline; filename="${input.filename}"`,
      contentType: input.contentType,
    },
  });
  try {
    await env.DB.prepare(
      `INSERT INTO user_documents
        (id,user_id,category,filename,object_key,content_type,size_bytes,
         r2_version,etag,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    )
      .bind(
        id,
        input.userId,
        input.category,
        input.filename,
        objectKey,
        input.contentType,
        input.length,
        object?.version ?? "",
        object?.etag ?? "",
        new Date().toISOString()
      )
      .run();
  } catch (error) {
    await env.DOCUMENTS.delete(objectKey);
    throw error;
  }
  if (input.category !== "test_lab") {
    await addDocumentToPacketVacancies(env.DB, input.userId, {
      category: input.category,
      id,
    });
  }
}

export function registerDocumentRoutes(app: JobKitApp) {
  app.get("/api/documents", async (c) => {
    const scope = c.req.query("scope");
    const documentScope =
      scope === "all" || scope === "test_lab" ? scope : "application";
    return c.json({
      documents: await listUserDocuments(
        c.env.DB,
        c.get("user").id,
        documentScope
      ),
    });
  });

  app.put("/api/documents", async (c) => {
    const length = Number(c.req.header("content-length") ?? 0);
    if (!validDocumentLength(length)) {
      return c.json(
        { message: "Files must be between 1 byte and 10 MB", ok: false },
        413
      );
    }
    const filename = safeFilename(
      decodeURIComponent(c.req.header("x-jobkit-filename") ?? "document")
    );
    const category = (c.req.header("x-jobkit-category") ?? "other").slice(
      0,
      40
    );
    const contentType =
      c.req.header("content-type") ?? "application/octet-stream";
    if (!allowedContentTypes.has(contentType)) {
      return c.json(
        { message: "Use PDF, DOCX, JPG, or PNG files", ok: false },
        415
      );
    }
    if (!c.req.raw.body) {
      return c.json({ message: "File body required", ok: false }, 400);
    }

    const userId = c.get("user").id;
    await persistUploadedDocument(c.env, {
      body: c.req.raw.body,
      category,
      contentType,
      filename,
      length,
      userId,
    });
    return c.json({ message: "Document uploaded", ok: true });
  });

  app.get("/api/documents/:id", async (c) => {
    const row = await c.env.DB.prepare(
      `SELECT filename,object_key,content_type
         FROM user_documents WHERE id=? AND user_id=?`
    )
      .bind(c.req.param("id"), c.get("user").id)
      .first<{
        content_type: string;
        filename: string;
        object_key: string;
      }>();
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
    const documentId = c.req.param("id");
    const userId = c.get("user").id;
    const row = await c.env.DB.prepare(
      "SELECT id FROM user_documents WHERE id=? AND user_id=? AND archived_at IS NULL"
    )
      .bind(documentId, userId)
      .first();
    if (!row) {
      return c.json({ message: "Document not found", ok: false }, 404);
    }
    const timestamp = new Date().toISOString();
    await c.env.DB.batch([
      c.env.DB.prepare(
        `DELETE FROM user_document_packet_items
          WHERE document_id=? AND packet_id IN
            (SELECT id FROM user_document_packets WHERE user_id=?)`
      ).bind(documentId, userId),
      c.env.DB.prepare(
        "UPDATE user_documents SET archived_at=? WHERE id=? AND user_id=?"
      ).bind(timestamp, documentId, userId),
    ]);
    return c.json({ message: "Document removed", ok: true });
  });

  app.get("/api/document-packets", async (c) =>
    c.json({
      packets: await listDocumentPackets(c.env.DB, c.get("user").id),
    })
  );

  app.put("/api/document-packets/default", async (c) => {
    const { packetId } = DefaultPacketSchema.parse(await c.req.json());
    await setDefaultDocumentPacket(c.env.DB, c.get("user").id, packetId);
    return c.json({ message: "Default document packet saved", ok: true });
  });
}

function safeFilename(value: string) {
  return value
    .replace(/[^a-z0-9._ -]/gi, "_")
    .replace(/\s+/g, " ")
    .slice(0, 120);
}
