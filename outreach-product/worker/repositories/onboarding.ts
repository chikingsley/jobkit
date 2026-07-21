import {
  PROFILE_IMPORT_PROPOSAL_SCHEMA_VERSION,
  type ProfileImportProposal,
  ProfileImportProposalSchema,
} from "../../src/features/onboarding/schema";

interface ImportRow {
  error_message: string | null;
  id: string;
  proposal_json: string | null;
  proposal_schema_version: number;
  source_text_detail: string;
  source_text_provider: string;
  status: "processing" | "ready" | "failed" | "applied";
}

export interface StoredProfileImport {
  errorMessage: string | null;
  id: string;
  proposal: ProfileImportProposal | null;
  sourceTextDetail: string;
  sourceTextProvider: string;
  status: ImportRow["status"];
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
  const result = await db
    .prepare(
      "UPDATE profile_imports SET status='ready',source_text_key=?,proposal_json=?,proposal_schema_version=?,model_provider=?,model_id=?,error_message=NULL,updated_at=? WHERE id=? AND user_id=? AND status='processing'"
    )
    .bind(
      input.sourceTextKey,
      JSON.stringify(input.proposal),
      PROFILE_IMPORT_PROPOSAL_SCHEMA_VERSION,
      input.modelProvider,
      input.modelId,
      input.updatedAt,
      input.importId,
      input.userId
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
  const result = await db
    .prepare(
      `UPDATE profile_imports
          SET source_text_key=?,source_text_provider=?,source_text_detail=?,
              updated_at=?
        WHERE id=? AND user_id=? AND status='processing'`
    )
    .bind(
      input.sourceTextKey,
      input.provider,
      input.detail,
      input.updatedAt,
      input.importId,
      input.userId
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
  await db
    .prepare(
      "UPDATE profile_imports SET status='failed',error_message=?,updated_at=? WHERE id=? AND user_id=? AND status='processing'"
    )
    .bind(
      input.errorMessage.slice(0, 500),
      input.updatedAt,
      input.importId,
      input.userId
    )
    .run();
}

export async function readLatestProfileImport(
  db: D1Database,
  userId: string
): Promise<StoredProfileImport | null> {
  const row = await db
    .prepare(
      "SELECT id,status,proposal_json,proposal_schema_version,error_message,source_text_provider,source_text_detail FROM profile_imports WHERE user_id=? ORDER BY created_at DESC LIMIT 1"
    )
    .bind(userId)
    .first<ImportRow>();
  if (!row) {
    return null;
  }
  const proposal = parseStoredProposal(row);
  return {
    errorMessage: row.error_message,
    id: row.id,
    proposal,
    sourceTextDetail: row.source_text_detail,
    sourceTextProvider: row.source_text_provider,
    status: row.status,
  };
}

function parseStoredProposal(row: ImportRow) {
  if (!row.proposal_json) {
    return null;
  }
  if (row.proposal_schema_version !== PROFILE_IMPORT_PROPOSAL_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported profile import proposal schema version ${row.proposal_schema_version}; expected ${PROFILE_IMPORT_PROPOSAL_SCHEMA_VERSION}`
    );
  }
  const parsed = ProfileImportProposalSchema.safeParse(
    JSON.parse(row.proposal_json)
  );
  if (!parsed.success) {
    throw new Error(`Stored profile import ${row.id} failed validation`);
  }
  return parsed.data;
}

export async function readOnboardingCompletion(db: D1Database, userId: string) {
  const row = await db
    .prepare("SELECT completed_at FROM user_onboarding WHERE user_id=?")
    .bind(userId)
    .first<{ completed_at: string | null }>();
  return row?.completed_at ?? null;
}

export async function completeOnboarding(db: D1Database, userId: string) {
  const [profile, preferences, resume] = await Promise.all([
    db
      .prepare("SELECT 1 present FROM user_profiles WHERE user_id=?")
      .bind(userId)
      .first<{ present: number }>(),
    db
      .prepare("SELECT 1 present FROM user_preferences WHERE user_id=?")
      .bind(userId)
      .first<{ present: number }>(),
    db
      .prepare(
        "SELECT 1 present FROM user_documents WHERE user_id=? AND category='resume' AND archived_at IS NULL LIMIT 1"
      )
      .bind(userId)
      .first<{ present: number }>(),
  ]);
  if (!(profile && preferences && resume)) {
    throw new OnboardingIncompleteError(
      "Profile, preferences, and a resume are required before onboarding"
    );
  }
  const timestamp = new Date().toISOString();
  await db
    .prepare(
      "INSERT INTO user_onboarding (user_id,completed_at,updated_at) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET completed_at=excluded.completed_at,updated_at=excluded.updated_at"
    )
    .bind(userId, timestamp, timestamp)
    .run();
  return timestamp;
}
