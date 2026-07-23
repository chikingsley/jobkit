import {
  type DocumentPacket,
  type DocumentPacketSlug,
  documentPacketDefinitions,
} from "../../src/features/documents/types";

interface DocumentRow {
  category: string;
  document_id: string | null;
  filename: string | null;
  is_default: number;
  packet_id: string;
  packet_name: string;
  position: number | null;
  slug: string;
}

async function readPacketSeedDocuments(db: D1Database, userId: string) {
  const documents = await db
    .prepare(
      `SELECT id,category,filename
         FROM user_documents
        WHERE user_id=? AND archived_at IS NULL
        ORDER BY is_default DESC,created_at DESC`
    )
    .bind(userId)
    .all<{ category: string; filename: string; id: string }>();
  const documentByCategory = new Map<
    string,
    { filename: string; id: string }
  >();
  for (const document of documents.results) {
    if (!documentByCategory.has(document.category)) {
      documentByCategory.set(document.category, document);
    }
  }
  return documentByCategory;
}

function buildDocumentPacketStatements(
  db: D1Database,
  userId: string,
  documentByCategory: Map<string, { filename: string; id: string }>,
  timestamp: string
) {
  const statements: D1PreparedStatement[] = [];
  for (const [
    definitionIndex,
    definition,
  ] of documentPacketDefinitions.entries()) {
    const packetId = crypto.randomUUID();
    statements.push(
      db
        .prepare(
          `INSERT INTO user_document_packets
          (id,user_id,slug,name,is_default,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?)`
        )
        .bind(
          packetId,
          userId,
          definition.slug,
          definition.name,
          definitionIndex === 0 ? 1 : 0,
          timestamp,
          timestamp
        )
    );
    for (const [position, category] of definition.categories.entries()) {
      const document = documentByCategory.get(category);
      if (document) {
        statements.push(
          db
            .prepare(
              `INSERT INTO user_document_packet_items
              (packet_id,category,document_id,position,created_at,updated_at)
             VALUES (?,?,?,?,?,?)`
            )
            .bind(
              packetId,
              category,
              document.id,
              position,
              timestamp,
              timestamp
            )
        );
      }
    }
  }
  return statements;
}

async function documentPacketsExist(db: D1Database, userId: string) {
  const result = await db
    .prepare("SELECT COUNT(*) count FROM user_document_packets WHERE user_id=?")
    .bind(userId)
    .first<{ count: number }>();
  return (result?.count ?? 0) > 0;
}

export async function ensureDocumentPackets(
  db: D1Database,
  userId: string
): Promise<void> {
  if (await documentPacketsExist(db, userId)) {
    return;
  }

  const timestamp = new Date().toISOString();
  const documentByCategory = await readPacketSeedDocuments(db, userId);
  const statements = buildDocumentPacketStatements(
    db,
    userId,
    documentByCategory,
    timestamp
  );

  try {
    await db.batch(statements);
  } catch (error) {
    if (!(await documentPacketsExist(db, userId))) {
      throw error;
    }
  }
}

export async function listDocumentPackets(
  db: D1Database,
  userId: string
): Promise<DocumentPacket[]> {
  await ensureDocumentPackets(db, userId);
  const rows = await db
    .prepare(
      `SELECT p.id packet_id,p.slug,p.name,p.is_default,
              i.category,i.position,d.id document_id,d.filename
         FROM user_document_packets p
         LEFT JOIN user_document_packet_items i ON i.packet_id=p.id
         LEFT JOIN user_documents d ON d.id=i.document_id
        WHERE p.user_id=?
        ORDER BY p.created_at,i.position`
    )
    .bind(userId)
    .all<DocumentRow>();

  const packets = new Map<string, DocumentPacket>();
  for (const row of rows.results) {
    const definition = documentPacketDefinitions.find(
      (candidate) => candidate.slug === row.slug
    );
    if (!definition) {
      continue;
    }
    let packet = packets.get(row.packet_id);
    if (!packet) {
      packet = {
        description: definition.description,
        id: row.packet_id,
        isDefault: row.is_default === 1,
        items: [],
        missingCategories: [],
        name: row.packet_name,
        slug: definition.slug,
      };
      packets.set(row.packet_id, packet);
    }
    if (
      row.category &&
      row.document_id &&
      row.filename &&
      row.position !== null
    ) {
      packet.items.push({
        category: row.category,
        documentId: row.document_id,
        filename: row.filename,
        position: row.position,
      });
    }
  }

  for (const packet of packets.values()) {
    const definition = documentPacketDefinitions.find(
      (candidate) => candidate.slug === packet.slug
    );
    const selected = new Set(packet.items.map((item) => item.category));
    packet.missingCategories = (definition?.categories ?? []).filter(
      (category) => !selected.has(category)
    );
  }
  return [...packets.values()];
}

export async function setDefaultDocumentPacket(
  db: D1Database,
  userId: string,
  packetId: string
): Promise<void> {
  const packet = await db
    .prepare("SELECT id FROM user_document_packets WHERE id=? AND user_id=?")
    .bind(packetId, userId)
    .first();
  if (!packet) {
    throw new Error("Document packet not found");
  }
  const timestamp = new Date().toISOString();
  await db.batch([
    db
      .prepare(
        "UPDATE user_document_packets SET is_default=0,updated_at=? WHERE user_id=? AND is_default=1"
      )
      .bind(timestamp, userId),
    db
      .prepare(
        "UPDATE user_document_packets SET is_default=1,updated_at=? WHERE id=? AND user_id=?"
      )
      .bind(timestamp, packetId, userId),
  ]);
}

export async function addDocumentToPacketVacancies(
  db: D1Database,
  userId: string,
  document: { category: string; id: string }
): Promise<void> {
  await ensureDocumentPackets(db, userId);
  const packets = await db
    .prepare("SELECT id,slug FROM user_document_packets WHERE user_id=?")
    .bind(userId)
    .all<{ id: string; slug: DocumentPacketSlug }>();
  const timestamp = new Date().toISOString();
  const statements: D1PreparedStatement[] = [];
  for (const packet of packets.results) {
    const definition = documentPacketDefinitions.find(
      (candidate) => candidate.slug === packet.slug
    );
    const categories: readonly string[] = definition?.categories ?? [];
    const position = categories.indexOf(document.category);
    if (position < 0) {
      continue;
    }
    statements.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO user_document_packet_items
          (packet_id,category,document_id,position,created_at,updated_at)
         VALUES (?,?,?,?,?,?)`
        )
        .bind(
          packet.id,
          document.category,
          document.id,
          position,
          timestamp,
          timestamp
        )
    );
  }
  if (statements.length > 0) {
    await db.batch(statements);
  }
}
