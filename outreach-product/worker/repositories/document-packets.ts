import { and, asc, count, desc, eq, isNull } from "drizzle-orm";
import {
  type DocumentPacket,
  type DocumentPacketSlug,
  documentPacketDefinitions,
} from "../../src/features/documents/types";
import { getDb } from "../db/client";
import {
  userDocumentPacketItems,
  userDocumentPackets,
  userDocuments,
} from "../db/schema/user-profile";

async function readPacketSeedDocuments(db: D1Database, userId: string) {
  const documents = await getDb(db)
    .select({
      category: userDocuments.category,
      filename: userDocuments.filename,
      id: userDocuments.id,
    })
    .from(userDocuments)
    .where(
      and(eq(userDocuments.userId, userId), isNull(userDocuments.archivedAt))
    )
    .orderBy(desc(userDocuments.isDefault), desc(userDocuments.createdAt));
  const documentByCategory = new Map<
    string,
    { filename: string; id: string }
  >();
  for (const document of documents) {
    if (!documentByCategory.has(document.category)) {
      documentByCategory.set(document.category, document);
    }
  }
  return documentByCategory;
}

// Ordered multi-statement D1 batch (packet inserts followed by item inserts
// that reference them); batch atomicity depends on statement ordering, so it
// stays raw SQL.
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
  const result = await getDb(db)
    .select({ count: count() })
    .from(userDocumentPackets)
    .where(eq(userDocumentPackets.userId, userId))
    .get();
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
  const rows = await getDb(db)
    .select({
      category: userDocumentPacketItems.category,
      documentId: userDocuments.id,
      filename: userDocuments.filename,
      isDefault: userDocumentPackets.isDefault,
      packetId: userDocumentPackets.id,
      packetName: userDocumentPackets.name,
      position: userDocumentPacketItems.position,
      slug: userDocumentPackets.slug,
    })
    .from(userDocumentPackets)
    .leftJoin(
      userDocumentPacketItems,
      eq(userDocumentPacketItems.packetId, userDocumentPackets.id)
    )
    .leftJoin(
      userDocuments,
      eq(userDocuments.id, userDocumentPacketItems.documentId)
    )
    .where(eq(userDocumentPackets.userId, userId))
    .orderBy(
      asc(userDocumentPackets.createdAt),
      asc(userDocumentPacketItems.position)
    );

  const packets = new Map<string, DocumentPacket>();
  for (const row of rows) {
    const definition = documentPacketDefinitions.find(
      (candidate) => candidate.slug === row.slug
    );
    if (!definition) {
      continue;
    }
    let packet = packets.get(row.packetId);
    if (!packet) {
      packet = {
        description: definition.description,
        id: row.packetId,
        isDefault: row.isDefault === 1,
        items: [],
        missingCategories: [],
        name: row.packetName,
        slug: definition.slug,
      };
      packets.set(row.packetId, packet);
    }
    if (
      row.category &&
      row.documentId &&
      row.filename &&
      row.position !== null
    ) {
      packet.items.push({
        category: row.category,
        documentId: row.documentId,
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

// Ordered two-statement D1 batch (clear the previous default, then set the
// new one); batch atomicity depends on statement ordering, so it stays raw.
export async function setDefaultDocumentPacket(
  db: D1Database,
  userId: string,
  packetId: string
): Promise<void> {
  const packet = await getDb(db)
    .select({ id: userDocumentPackets.id })
    .from(userDocumentPackets)
    .where(
      and(
        eq(userDocumentPackets.id, packetId),
        eq(userDocumentPackets.userId, userId)
      )
    )
    .get();
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
  const packets = await getDb(db)
    .select({
      id: userDocumentPackets.id,
      slug: userDocumentPackets.slug,
    })
    .from(userDocumentPackets)
    .where(eq(userDocumentPackets.userId, userId));
  const timestamp = new Date().toISOString();
  const rows: (typeof userDocumentPacketItems.$inferInsert)[] = [];
  for (const packet of packets) {
    const definition = documentPacketDefinitions.find(
      (candidate) => candidate.slug === (packet.slug as DocumentPacketSlug)
    );
    const categories: readonly string[] = definition?.categories ?? [];
    const position = categories.indexOf(document.category);
    if (position < 0) {
      continue;
    }
    rows.push({
      category: document.category,
      createdAt: timestamp,
      documentId: document.id,
      packetId: packet.id,
      position,
      updatedAt: timestamp,
    });
  }
  if (rows.length > 0) {
    await getDb(db)
      .insert(userDocumentPacketItems)
      .values(rows)
      .onConflictDoNothing()
      .run();
  }
}
