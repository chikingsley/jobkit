import { and, desc, eq, isNull, sql } from "drizzle-orm";
import {
  PROFILE_IMPORT_PROPOSAL_SCHEMA_VERSION,
  type ProfileImportProposal,
  ProfileImportProposalSchema,
} from "../../src/features/onboarding/schema";
import { excluded, getDb } from "../db/client";
import {
  profileImports,
  userDocuments,
  userOnboarding,
  userPreferences,
  userProfiles,
} from "../db/schema/user-profile";

interface StoredImportRow {
  errorMessage: string | null;
  id: string;
  proposalJson: string | null;
  proposalSchemaVersion: number;
  sourceTextDetail: string;
  sourceTextProvider: string;
  status: string;
}

export interface StoredProfileImport {
  errorMessage: string | null;
  id: string;
  proposal: ProfileImportProposal | null;
  sourceTextDetail: string;
  sourceTextProvider: string;
  status: "processing" | "ready" | "failed" | "applied";
}

export class OnboardingIncompleteError extends Error {}

export async function createProfileImportRecords(
  db: D1Database,
  input: {
    contentType: string;
    createdAt: string;
    documentId: string;
    filename: string;
    importId: string;
    objectKey: string;
    sizeBytes: number;
    userId: string;
  }
) {
  await db.batch([
    db
      .prepare(
        "INSERT INTO user_documents (id,user_id,category,filename,object_key,content_type,size_bytes,is_default,created_at) VALUES (?,?,?,?,?,?,?,1,?)"
      )
      .bind(
        input.documentId,
        input.userId,
        "resume",
        input.filename,
        input.objectKey,
        input.contentType,
        input.sizeBytes,
        input.createdAt
      ),
    db
      .prepare(
        "INSERT INTO profile_imports (id,user_id,document_id,status,created_at,updated_at) VALUES (?,?,?,'processing',?,?)"
      )
      .bind(
        input.importId,
        input.userId,
        input.documentId,
        input.createdAt,
        input.createdAt
      ),
  ]);
}

export async function finishProfileImport(
  db: D1Database,
  input: {
    importId: string;
    modelId: string;
    modelProvider: string;
    proposal: ProfileImportProposal;
    sourceTextKey: string;
    updatedAt: string;
    userId: string;
  }
) {
  const result = await getDb(db)
    .update(profileImports)
    .set({
      errorMessage: null,
      modelId: input.modelId,
      modelProvider: input.modelProvider,
      proposalJson: JSON.stringify(input.proposal),
      proposalSchemaVersion: PROFILE_IMPORT_PROPOSAL_SCHEMA_VERSION,
      sourceTextKey: input.sourceTextKey,
      status: "ready",
      updatedAt: input.updatedAt,
    })
    .where(
      and(
        eq(profileImports.id, input.importId),
        eq(profileImports.userId, input.userId),
        eq(profileImports.status, "processing")
      )
    )
    .run();
  if ((result.meta.changes ?? 0) !== 1) {
    throw new Error("Profile import could not be completed");
  }
}

export async function recordProfileImportSource(
  db: D1Database,
  input: {
    detail: string;
    importId: string;
    provider: string;
    sourceTextKey: string;
    updatedAt: string;
    userId: string;
  }
) {
  const result = await getDb(db)
    .update(profileImports)
    .set({
      sourceTextDetail: input.detail,
      sourceTextKey: input.sourceTextKey,
      sourceTextProvider: input.provider,
      updatedAt: input.updatedAt,
    })
    .where(
      and(
        eq(profileImports.id, input.importId),
        eq(profileImports.userId, input.userId),
        eq(profileImports.status, "processing")
      )
    )
    .run();
  if ((result.meta.changes ?? 0) !== 1) {
    throw new Error("Profile import source could not be recorded");
  }
}

export async function failProfileImport(
  db: D1Database,
  input: {
    errorMessage: string;
    importId: string;
    updatedAt: string;
    userId: string;
  }
) {
  await getDb(db)
    .update(profileImports)
    .set({
      errorMessage: input.errorMessage.slice(0, 500),
      status: "failed",
      updatedAt: input.updatedAt,
    })
    .where(
      and(
        eq(profileImports.id, input.importId),
        eq(profileImports.userId, input.userId),
        eq(profileImports.status, "processing")
      )
    )
    .run();
}

export async function readLatestProfileImport(
  db: D1Database,
  userId: string
): Promise<StoredProfileImport | null> {
  const row = await getDb(db)
    .select({
      errorMessage: profileImports.errorMessage,
      id: profileImports.id,
      proposalJson: profileImports.proposalJson,
      proposalSchemaVersion: profileImports.proposalSchemaVersion,
      sourceTextDetail: profileImports.sourceTextDetail,
      sourceTextProvider: profileImports.sourceTextProvider,
      status: profileImports.status,
    })
    .from(profileImports)
    .where(eq(profileImports.userId, userId))
    .orderBy(desc(profileImports.createdAt))
    .limit(1)
    .get();
  if (!row) {
    return null;
  }
  const proposal = parseStoredProposal(row);
  return {
    errorMessage: row.errorMessage,
    id: row.id,
    proposal,
    sourceTextDetail: row.sourceTextDetail,
    sourceTextProvider: row.sourceTextProvider,
    status: row.status as StoredProfileImport["status"],
  };
}

function parseStoredProposal(row: StoredImportRow) {
  if (!row.proposalJson) {
    return null;
  }
  if (row.proposalSchemaVersion !== PROFILE_IMPORT_PROPOSAL_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported profile import proposal schema version ${row.proposalSchemaVersion}; expected ${PROFILE_IMPORT_PROPOSAL_SCHEMA_VERSION}`
    );
  }
  const parsed = ProfileImportProposalSchema.safeParse(
    JSON.parse(row.proposalJson)
  );
  if (!parsed.success) {
    throw new Error(`Stored profile import ${row.id} failed validation`);
  }
  return parsed.data;
}

export async function readOnboardingCompletion(db: D1Database, userId: string) {
  const row = await getDb(db)
    .select({ completedAt: userOnboarding.completedAt })
    .from(userOnboarding)
    .where(eq(userOnboarding.userId, userId))
    .get();
  return row?.completedAt ?? null;
}

export async function completeOnboarding(db: D1Database, userId: string) {
  const one = sql<number>`1`;
  const [profile, preferences, resume] = await Promise.all([
    getDb(db)
      .select({ present: one })
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId))
      .get(),
    getDb(db)
      .select({ present: one })
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId))
      .get(),
    getDb(db)
      .select({ present: one })
      .from(userDocuments)
      .where(
        and(
          eq(userDocuments.userId, userId),
          eq(userDocuments.category, "resume"),
          isNull(userDocuments.archivedAt)
        )
      )
      .limit(1)
      .get(),
  ]);
  if (!(profile && preferences && resume)) {
    throw new OnboardingIncompleteError(
      "Profile, preferences, and a resume are required before onboarding"
    );
  }
  const timestamp = new Date().toISOString();
  await getDb(db)
    .insert(userOnboarding)
    .values({ completedAt: timestamp, updatedAt: timestamp, userId })
    .onConflictDoUpdate({
      set: {
        completedAt: excluded(userOnboarding.completedAt),
        updatedAt: excluded(userOnboarding.updatedAt),
      },
      target: userOnboarding.userId,
    })
    .run();
  return timestamp;
}
