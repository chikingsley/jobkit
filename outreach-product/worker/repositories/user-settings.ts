import {
  defaultPreferences,
  PREFERENCES_SCHEMA_VERSION,
  type Preferences,
  PreferencesSchema,
} from "../../src/features/preferences/schema";
import {
  defaultProfile,
  PROFILE_SCHEMA_VERSION,
  type Profile,
  ProfileSchema,
} from "../../src/features/profile/schema";

interface VersionedRow {
  payload: string;
  schema_version: number;
  updated_at: string;
}

interface VersionedValue<Value> {
  updatedAt: string | null;
  value: Value;
}

export async function readProfile(
  db: D1Database,
  userId: string
): Promise<VersionedValue<Profile>> {
  const row = await db
    .prepare(
      "SELECT profile_json AS payload,schema_version,updated_at FROM user_profiles WHERE user_id=?"
    )
    .bind(userId)
    .first<VersionedRow>();
  if (!row) {
    return { updatedAt: null, value: defaultProfile };
  }
  requireSchemaVersion("profile", row.schema_version, PROFILE_SCHEMA_VERSION);
  return {
    updatedAt: row.updated_at,
    value: ProfileSchema.parse(JSON.parse(row.payload)),
  };
}

export async function writeProfile(
  db: D1Database,
  userId: string,
  input: unknown
) {
  const profile = ProfileSchema.parse(input);
  const updatedAt = new Date().toISOString();
  await db
    .prepare(
      "INSERT INTO user_profiles (id,user_id,profile_json,updated_at,schema_version) VALUES (?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET profile_json=excluded.profile_json,updated_at=excluded.updated_at,schema_version=excluded.schema_version"
    )
    .bind(
      crypto.randomUUID(),
      userId,
      JSON.stringify(profile),
      updatedAt,
      PROFILE_SCHEMA_VERSION
    )
    .run();
  return { updatedAt, value: profile };
}

export async function readPreferences(
  db: D1Database,
  userId: string
): Promise<VersionedValue<Preferences>> {
  const row = await db
    .prepare(
      "SELECT preferences_json AS payload,schema_version,updated_at FROM user_preferences WHERE user_id=?"
    )
    .bind(userId)
    .first<VersionedRow>();
  if (!row) {
    return { updatedAt: null, value: defaultPreferences };
  }
  requireSchemaVersion(
    "preferences",
    row.schema_version,
    PREFERENCES_SCHEMA_VERSION
  );
  return {
    updatedAt: row.updated_at,
    value: PreferencesSchema.parse(JSON.parse(row.payload)),
  };
}

export async function writePreferences(
  db: D1Database,
  userId: string,
  input: unknown
) {
  const preferences = PreferencesSchema.parse(input);
  const updatedAt = new Date().toISOString();
  await db
    .prepare(
      "INSERT INTO user_preferences (id,user_id,preferences_json,updated_at,schema_version) VALUES (?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET preferences_json=excluded.preferences_json,updated_at=excluded.updated_at,schema_version=excluded.schema_version"
    )
    .bind(
      crypto.randomUUID(),
      userId,
      JSON.stringify(preferences),
      updatedAt,
      PREFERENCES_SCHEMA_VERSION
    )
    .run();
  return { updatedAt, value: preferences };
}

function requireSchemaVersion(
  subject: string,
  actual: number,
  expected: number
) {
  if (actual !== expected) {
    throw new Error(
      `Unsupported ${subject} schema version ${actual}; expected ${expected}`
    );
  }
}
