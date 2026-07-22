import { documentPacketDefinitions } from "../../src/features/documents/types";
import type { AppEnv } from "../env";
import type {
  AgentTaskCompletionCondition,
  AgentTaskCompletionFence,
  AgentTaskCompletionWrite,
} from "../services/agent-tasks/run-store";
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

export async function defaultPacketSnapshotWrites(
  env: AppEnv,
  userId: string,
  draftId: string,
  timestamp: string,
  fence: AgentTaskCompletionFence
): Promise<AgentTaskCompletionWrite[]> {
  const snapshot = await readDefaultPacketSnapshot(env, userId);
  if (!snapshot) {
    return [];
  }
  const { definition, first, resolved } = snapshot;

  const writes: AgentTaskCompletionWrite[] = [
    {
      expectedChanges: 1,
      statement: env.DB.prepare(
        `UPDATE application_drafts
            SET document_packet_id=?,document_packet_name=?,
                document_packet_slug=?,document_packet_manifest_json=?
          WHERE id=? AND ${fence.clause}`
      ).bind(
        first.packet_id,
        first.packet_name,
        first.packet_slug,
        JSON.stringify(definition.categories),
        draftId,
        ...fence.values
      ),
    },
  ];
  for (const item of resolved) {
    writes.push(
      {
        statement: env.DB.prepare(
          `UPDATE user_documents SET r2_version=?,etag=?
            WHERE id=? AND user_id=? AND (r2_version='' OR etag='')
              AND ${fence.clause}`
        ).bind(
          item.r2Version,
          item.etag,
          item.document.document_id,
          userId,
          ...fence.values
        ),
      },
      {
        expectedChanges: 1,
        statement: env.DB.prepare(
          `INSERT INTO application_draft_attachments
            (draft_id,position,source_document_id,category,filename,object_key,
             content_type,size_bytes,r2_version,etag,created_at)
           SELECT ?,?,?,?,?,?,?,?,?,?,?
            WHERE ${fence.clause}`
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
          timestamp,
          ...fence.values
        ),
      }
    );
  }
  return writes;
}

export async function defaultPacketSnapshotStatements(
  env: AppEnv,
  userId: string,
  draftId: string,
  timestamp: string
): Promise<D1PreparedStatement[]> {
  await ensureDocumentPackets(env.DB, userId);
  const snapshot = await readDefaultPacketSnapshot(env, userId);
  if (!snapshot) {
    return [];
  }
  const { definition, first, resolved } = snapshot;
  return [
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
    ...resolved.flatMap((item) => [
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
      ),
    ]),
  ];
}

export async function defaultCampaignPacketSnapshotStatements(
  env: AppEnv,
  userId: string,
  dispatchId: string,
  timestamp: string
): Promise<D1PreparedStatement[]> {
  await ensureDocumentPackets(env.DB, userId);
  const snapshot = await readDefaultPacketSnapshot(env, userId);
  if (!snapshot) {
    return [];
  }
  const { definition, first, resolved } = snapshot;
  return [
    env.DB.prepare(
      `UPDATE campaign_dispatches
          SET document_packet_id=?,document_packet_name=?,
              document_packet_slug=?,document_packet_manifest_json=?
        WHERE id=?`
    ).bind(
      first.packet_id,
      first.packet_name,
      first.packet_slug,
      JSON.stringify(definition.categories),
      dispatchId
    ),
    ...resolved.flatMap((item) => [
      env.DB.prepare(
        `UPDATE user_documents SET r2_version=?,etag=?
          WHERE id=? AND user_id=? AND (r2_version='' OR etag='')`
      ).bind(item.r2Version, item.etag, item.document.document_id, userId),
      env.DB.prepare(
        `INSERT INTO campaign_dispatch_attachments
          (dispatch_id,position,source_document_id,category,filename,
           object_key,content_type,size_bytes,r2_version,etag,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`
      ).bind(
        dispatchId,
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
      ),
    ]),
  ];
}

async function readDefaultPacketSnapshot(env: AppEnv, userId: string) {
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
    return null;
  }
  const definition = documentPacketDefinitions.find(
    (candidate) => candidate.slug === first.packet_slug
  );
  if (!definition) {
    throw new DocumentPacketSnapshotError(
      "Document packet definition is invalid"
    );
  }
  const resolved = await Promise.all(
    rows.results
      .filter((row) => row.document_id)
      .map(async (document) => {
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
  return { definition, first, resolved };
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

export async function copyPacketSnapshotWrites(
  db: D1Database,
  sourceDraftId: string,
  targetDraftId: string,
  timestamp: string,
  fence: AgentTaskCompletionFence
): Promise<{
  condition: AgentTaskCompletionCondition;
  writes: AgentTaskCompletionWrite[];
}> {
  const source = await db
    .prepare(
      `SELECT source.document_packet_id,source.document_packet_name,
              source.document_packet_slug,source.document_packet_manifest_json,
              json_array_length(source.document_packet_manifest_json)
                attachment_count
         FROM application_drafts source
         JOIN user_document_packets packet
           ON packet.id=source.document_packet_id
          AND packet.slug=source.document_packet_slug
          AND packet.name=source.document_packet_name
        WHERE source.id=?
          AND ${packetSnapshotCompletenessClause("source")}`
    )
    .bind(sourceDraftId)
    .first<{
      attachment_count: number;
      document_packet_id: string;
      document_packet_manifest_json: string;
      document_packet_name: string;
      document_packet_slug: string;
    }>();
  if (!source) {
    throw new DocumentPacketSnapshotError(
      "The source draft does not contain a valid document packet snapshot"
    );
  }
  const definition = documentPacketDefinitions.find(
    (candidate) =>
      candidate.slug === source.document_packet_slug &&
      JSON.stringify(candidate.categories) ===
        JSON.stringify(JSON.parse(source.document_packet_manifest_json))
  );
  if (!definition) {
    throw new DocumentPacketSnapshotError(
      "The source draft packet manifest does not match its packet definition"
    );
  }
  const expectedAttachmentCount = Number(source.attachment_count);
  return {
    condition: {
      clause: `EXISTS (
        SELECT 1 FROM application_drafts packet_source
         WHERE packet_source.id=?
           AND packet_source.document_packet_id=?
           AND packet_source.document_packet_slug=?
           AND packet_source.document_packet_name=?
           AND json(packet_source.document_packet_manifest_json)=json(?)
           AND EXISTS (
             SELECT 1 FROM user_document_packets source_packet
              WHERE source_packet.id=packet_source.document_packet_id
                AND source_packet.slug=packet_source.document_packet_slug
                AND source_packet.name=packet_source.document_packet_name
           )
           AND ${packetSnapshotCompletenessClause("packet_source")}
           AND json_array_length(packet_source.document_packet_manifest_json)=?
      )`,
      values: [
        sourceDraftId,
        source.document_packet_id,
        definition.slug,
        source.document_packet_name,
        JSON.stringify(definition.categories),
        expectedAttachmentCount,
      ],
    },
    writes: [
      {
        expectedChanges: 1,
        statement: db
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
                      SELECT document_packet_manifest_json
                        FROM application_drafts WHERE id=?
                    )
              WHERE id=? AND ${fence.clause}`
          )
          .bind(
            sourceDraftId,
            sourceDraftId,
            sourceDraftId,
            sourceDraftId,
            targetDraftId,
            ...fence.values
          ),
      },
      {
        expectedChanges: expectedAttachmentCount,
        statement: db
          .prepare(
            `INSERT INTO application_draft_attachments
              (draft_id,position,source_document_id,category,filename,object_key,
               content_type,size_bytes,r2_version,etag,created_at)
             SELECT ?,position,source_document_id,category,filename,object_key,
                    content_type,size_bytes,r2_version,etag,?
               FROM application_draft_attachments
              WHERE draft_id=? AND ${fence.clause}`
          )
          .bind(targetDraftId, timestamp, sourceDraftId, ...fence.values),
      },
    ],
  };
}

function packetSnapshotCompletenessClause(sourceAlias: string) {
  return `${sourceAlias}.document_packet_id IS NOT NULL
    AND ${sourceAlias}.document_packet_name<>''
    AND ${sourceAlias}.document_packet_slug<>''
    AND json_type(${sourceAlias}.document_packet_manifest_json)='array'
    AND json_array_length(${sourceAlias}.document_packet_manifest_json)=(
      SELECT COUNT(*) FROM application_draft_attachments packet_attachment
       WHERE packet_attachment.draft_id=${sourceAlias}.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM json_each(${sourceAlias}.document_packet_manifest_json)
        packet_category
       WHERE packet_category.type<>'text'
          OR (
            SELECT COUNT(*)
              FROM application_draft_attachments category_attachment
             WHERE category_attachment.draft_id=${sourceAlias}.id
               AND category_attachment.category=packet_category.value
          )<>1
    )
    AND NOT EXISTS (
      SELECT 1 FROM application_draft_attachments outside_attachment
       WHERE outside_attachment.draft_id=${sourceAlias}.id
         AND NOT EXISTS (
           SELECT 1 FROM json_each(
             ${sourceAlias}.document_packet_manifest_json
           ) manifest_category
            WHERE manifest_category.type='text'
              AND manifest_category.value=outside_attachment.category
         )
    )`;
}
