import { documentPacketDefinitions } from "../../src/features/documents/types";
import type { AppEnv } from "../env";
import { ensureDocumentPackets } from "./document-packets";

interface PacketDocumentRow {
  category: string;
  content_type: string;
  document_id: string;
  etag: string;
  filename: string;
  object_key: string;
  packet_id: string;
  packet_name: string;
  packet_slug: string;
  position: number;
  r2_version: string;
  size_bytes: number;
}

export class DocumentPacketSnapshotError extends Error {}

export async function defaultPacketSnapshotStatements(
  env: AppEnv,
  userId: string,
  draftId: string,
  timestamp: string
): Promise<D1PreparedStatement[]> {
  await ensureDocumentPackets(env.DB, userId);
  const rows = await env.DB.prepare(
    `SELECT p.id packet_id,p.name packet_name,p.slug packet_slug,i.position,
            i.category,d.id document_id,d.filename,d.object_key,d.content_type,
            d.size_bytes,d.r2_version,d.etag
       FROM user_document_packets p
       LEFT JOIN user_document_packet_items i ON i.packet_id=p.id
       LEFT JOIN user_documents d ON d.id=i.document_id
      WHERE p.user_id=? AND p.is_default=1
      ORDER BY i.position`
  )
    .bind(userId)
    .all<PacketDocumentRow>();
  const [first] = rows.results;
  if (!first) {
    return [];
  }
  const definition = documentPacketDefinitions.find(
    (candidate) => candidate.slug === first.packet_slug
  );
  if (!definition) {
    throw new DocumentPacketSnapshotError(
      "Document packet definition is invalid"
    );
  }

  const documents = rows.results.filter((row) => row.document_id);
  const resolved = await Promise.all(
    documents.map(async (document) => {
      const object = await env.DOCUMENTS.head(document.object_key);
      if (!object) {
        throw new DocumentPacketSnapshotError(
          `Document packet file is missing: ${document.filename}`
        );
      }
      if (
        (document.r2_version && document.r2_version !== object.version) ||
        (document.etag && document.etag !== object.etag)
      ) {
        throw new DocumentPacketSnapshotError(
          `Document packet file changed unexpectedly: ${document.filename}`
        );
      }
      return { document, etag: object.etag, r2Version: object.version };
    })
  );

  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      `UPDATE application_drafts
          SET document_packet_id=?,document_packet_name=?,
              document_packet_slug=?,document_packet_manifest_json=?
        WHERE id=?`
    ).bind(
      first.packet_id,
      first.packet_name,
      first.packet_slug,
      JSON.stringify(definition.categories),
      draftId
    ),
  ];
  for (const item of resolved) {
    statements.push(
      env.DB.prepare(
        `UPDATE user_documents SET r2_version=?,etag=?
          WHERE id=? AND user_id=? AND (r2_version='' OR etag='')`
      ).bind(item.r2Version, item.etag, item.document.document_id, userId),
      env.DB.prepare(
        `INSERT INTO application_draft_attachments
          (draft_id,position,source_document_id,category,filename,object_key,
           content_type,size_bytes,r2_version,etag,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`
      ).bind(
        draftId,
        item.document.position,
        item.document.document_id,
        item.document.category,
        item.document.filename,
        item.document.object_key,
        item.document.content_type,
        item.document.size_bytes,
        item.r2Version,
        item.etag,
        timestamp
      )
    );
  }
  return statements;
}

export function copyPacketSnapshotStatements(
  db: D1Database,
  sourceDraftId: string,
  targetDraftId: string,
  timestamp: string
): D1PreparedStatement[] {
  return [
    db
      .prepare(
        `UPDATE application_drafts
          SET document_packet_id=(
                SELECT document_packet_id FROM application_drafts WHERE id=?
              ),
              document_packet_name=(
                SELECT document_packet_name FROM application_drafts WHERE id=?
              ),
              document_packet_slug=(
                SELECT document_packet_slug FROM application_drafts WHERE id=?
              ),
              document_packet_manifest_json=(
                SELECT document_packet_manifest_json FROM application_drafts WHERE id=?
              )
        WHERE id=?`
      )
      .bind(
        sourceDraftId,
        sourceDraftId,
        sourceDraftId,
        sourceDraftId,
        targetDraftId
      ),
    db
      .prepare(
        `INSERT INTO application_draft_attachments
        (draft_id,position,source_document_id,category,filename,object_key,content_type,
         size_bytes,r2_version,etag,created_at)
       SELECT ?,position,source_document_id,category,filename,object_key,content_type,
              size_bytes,r2_version,etag,?
         FROM application_draft_attachments WHERE draft_id=?`
      )
      .bind(targetDraftId, timestamp, sourceDraftId),
  ];
}
