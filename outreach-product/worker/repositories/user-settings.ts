import { eq } from "drizzle-orm";
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
import { excluded, getDb } from "../db/client";
import { userPreferences, userProfiles } from "../db/schema/user-profile";

interface VersionedValue<Value> {
  updatedAt: string | null;
  value: Value;
}

export async function readProfile(
  db: D1Database,
  userId: string
): Promise<VersionedValue<Profile>> {
  const row = await getDb(db)
    .select({
      payload: userProfiles.profileJson,
      schemaVersion: userProfiles.schemaVersion,
      updatedAt: userProfiles.updatedAt,
    })
    .from(userProfiles)
    .where(eq(userProfiles.userId, userId))
    .get();
  if (!row) {
    return { updatedAt: null, value: defaultProfile };
  }
  const payload = JSON.parse(row.payload);
  return {
    updatedAt: row.updatedAt,
    value: ProfileSchema.parse(
      upgradeProfilePayload(payload, row.schemaVersion)
    ),
  };
}

export async function writeProfile(
  db: D1Database,
  userId: string,
  input: unknown
) {
  const profile = ProfileSchema.parse(input);
  const updatedAt = new Date().toISOString();
  await getDb(db)
    .insert(userProfiles)
    .values({
      id: crypto.randomUUID(),
      profileJson: JSON.stringify(profile),
      schemaVersion: PROFILE_SCHEMA_VERSION,
      updatedAt,
      userId,
    })
    .onConflictDoUpdate({
      set: {
        profileJson: excluded(userProfiles.profileJson),
        schemaVersion: excluded(userProfiles.schemaVersion),
        updatedAt: excluded(userProfiles.updatedAt),
      },
      target: userProfiles.userId,
    })
    .run();
  return { updatedAt, value: profile };
}

export async function readPreferences(
  db: D1Database,
  userId: string
): Promise<VersionedValue<Preferences>> {
  const row = await getDb(db)
    .select({
      payload: userPreferences.preferencesJson,
      schemaVersion: userPreferences.schemaVersion,
      updatedAt: userPreferences.updatedAt,
    })
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .get();
  if (!row) {
    return { updatedAt: null, value: defaultPreferences };
  }
  requireSchemaVersion(
    "preferences",
    row.schemaVersion,
    PREFERENCES_SCHEMA_VERSION
  );
  return {
    updatedAt: row.updatedAt,
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
  await getDb(db)
    .insert(userPreferences)
    .values({
      id: crypto.randomUUID(),
      preferencesJson: JSON.stringify(preferences),
      schemaVersion: PREFERENCES_SCHEMA_VERSION,
      updatedAt,
      userId,
    })
    .onConflictDoUpdate({
      set: {
        preferencesJson: excluded(userPreferences.preferencesJson),
        schemaVersion: excluded(userPreferences.schemaVersion),
        updatedAt: excluded(userPreferences.updatedAt),
      },
      target: userPreferences.userId,
    })
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

function upgradeProfilePayload(payload: unknown, schemaVersion: number) {
  if (schemaVersion === PROFILE_SCHEMA_VERSION) {
    return payload;
  }
  if (schemaVersion === 4) {
    const profile = payload as {
      workExperience?: Record<string, unknown>[];
    };
    return {
      ...profile,
      workExperience: (profile.workExperience ?? []).map((entry) => ({
        ...entry,
        messageAttribution: "describe",
        messageHighlights: Array.isArray(entry.highlights)
          ? entry.highlights
          : [],
      })),
    };
  }
  requireSchemaVersion("profile", schemaVersion, PROFILE_SCHEMA_VERSION);
  return payload;
}
