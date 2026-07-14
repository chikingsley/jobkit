import { z } from "zod";
import {
  defaultPreferences,
  PREFERENCES_SCHEMA_VERSION,
  type Preferences,
  PreferencesSchema,
  type RuleStrength,
} from "../../src/features/preferences/schema";
import {
  type DegreeLevelSchema,
  defaultProfile,
  EducationEntrySchema,
  LanguageEntrySchema,
  PROFILE_SCHEMA_VERSION,
  type Profile,
  ProfileSchema,
  WorkAuthorizationEntrySchema,
} from "../../src/features/profile/schema";

const OWNER_ID = "owner";
const legacyRuleStrength = z.enum(["prefer", "accept", "avoid", "exclude"]);
const legacyBenefitStrength = z.enum([
  "required",
  "prefer",
  "accept",
  "avoid",
  "exclude",
]);

const LegacyProfileSchema = z.object({
  availability: z.string(),
  citizenship: z.string(),
  credentials: z.array(z.string()),
  currentLocation: z.string(),
  education: z.array(z.union([z.string(), EducationEntrySchema])),
  email: z.string(),
  experienceLabel: z.string(),
  fields: z.array(z.string()),
  fullName: z.string(),
  introduction: z.string(),
  languages: z.array(z.union([z.string(), LanguageEntrySchema])),
  phone: z.string(),
  preferredName: z.string(),
  profileReviewNotes: z.array(z.string()),
  workAuthorization: z.array(
    z.union([z.string(), WorkAuthorizationEntrySchema])
  ),
});

const LegacyPreferencesSchema = z.object({
  audiences: z.record(z.string(), legacyRuleStrength),
  benefits: z.record(z.string(), legacyBenefitStrength),
  countries: z.object({
    acceptable: z.array(z.string()),
    excluded: z.array(z.string()),
    preferred: z.array(z.string()),
  }),
  employment: z.record(z.string(), legacyRuleStrength),
  minimumMonthlyUsd: z.number(),
  requireVisaSponsorship: z.boolean().optional(),
  showUnknownHardConstraints: z.boolean().optional(),
  theme: z.enum(["system", "light", "dark"]).optional(),
});

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
  db: D1Database
): Promise<VersionedValue<Profile>> {
  const row = await db
    .prepare(
      "SELECT profile_json AS payload,schema_version,updated_at FROM user_profiles WHERE id=?"
    )
    .bind(OWNER_ID)
    .first<VersionedRow>();
  if (!row) {
    return { updatedAt: null, value: defaultProfile };
  }
  if (row.schema_version === PROFILE_SCHEMA_VERSION) {
    return {
      updatedAt: row.updated_at,
      value: ProfileSchema.parse(JSON.parse(row.payload)),
    };
  }
  if (row.schema_version !== 1) {
    throw new Error(`Unsupported profile schema version ${row.schema_version}`);
  }

  const profile = migrateProfileV1(JSON.parse(row.payload));
  const updatedAt = new Date().toISOString();
  const result = await db
    .prepare(
      "UPDATE user_profiles SET profile_json=?,schema_version=?,updated_at=? WHERE id=? AND schema_version=1"
    )
    .bind(JSON.stringify(profile), PROFILE_SCHEMA_VERSION, updatedAt, OWNER_ID)
    .run();
  if ((result.meta.changes ?? 0) === 0) {
    return readProfile(db);
  }
  return { updatedAt, value: profile };
}

export async function writeProfile(db: D1Database, input: unknown) {
  const profile = ProfileSchema.parse(input);
  const updatedAt = new Date().toISOString();
  await db
    .prepare(
      "INSERT INTO user_profiles (id,profile_json,updated_at,schema_version) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET profile_json=excluded.profile_json,updated_at=excluded.updated_at,schema_version=excluded.schema_version"
    )
    .bind(OWNER_ID, JSON.stringify(profile), updatedAt, PROFILE_SCHEMA_VERSION)
    .run();
  return { updatedAt, value: profile };
}

export async function readPreferences(
  db: D1Database
): Promise<VersionedValue<Preferences>> {
  const row = await db
    .prepare(
      "SELECT preferences_json AS payload,schema_version,updated_at FROM user_preferences WHERE id=?"
    )
    .bind(OWNER_ID)
    .first<VersionedRow>();
  if (!row) {
    return { updatedAt: null, value: defaultPreferences };
  }
  if (row.schema_version === PREFERENCES_SCHEMA_VERSION) {
    return {
      updatedAt: row.updated_at,
      value: PreferencesSchema.parse(JSON.parse(row.payload)),
    };
  }
  if (row.schema_version !== 1) {
    throw new Error(
      `Unsupported preferences schema version ${row.schema_version}`
    );
  }

  const preferences = migratePreferencesV1(JSON.parse(row.payload));
  const updatedAt = new Date().toISOString();
  const result = await db
    .prepare(
      "UPDATE user_preferences SET preferences_json=?,schema_version=?,updated_at=? WHERE id=? AND schema_version=1"
    )
    .bind(
      JSON.stringify(preferences),
      PREFERENCES_SCHEMA_VERSION,
      updatedAt,
      OWNER_ID
    )
    .run();
  if ((result.meta.changes ?? 0) === 0) {
    return readPreferences(db);
  }
  return { updatedAt, value: preferences };
}

export async function writePreferences(db: D1Database, input: unknown) {
  const preferences = PreferencesSchema.parse(input);
  const updatedAt = new Date().toISOString();
  await db
    .prepare(
      "INSERT INTO user_preferences (id,preferences_json,updated_at,schema_version) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET preferences_json=excluded.preferences_json,updated_at=excluded.updated_at,schema_version=excluded.schema_version"
    )
    .bind(
      OWNER_ID,
      JSON.stringify(preferences),
      updatedAt,
      PREFERENCES_SCHEMA_VERSION
    )
    .run();
  return { updatedAt, value: preferences };
}

export function migrateProfileV1(input: unknown): Profile {
  const legacy = LegacyProfileSchema.parse(input);
  return ProfileSchema.parse({
    ...legacy,
    availability:
      legacy.availability === "Available immediately"
        ? "immediately"
        : legacy.availability,
    education: legacy.education.map((entry) =>
      typeof entry === "string" ? migrateEducation(entry) : entry
    ),
    experienceLabel: legacy.experienceLabel.replace(
      /\s*[—-]\s*review against 7\+ profile claim$/i,
      ""
    ),
    languages: legacy.languages.map((entry) =>
      typeof entry === "string" ? migrateLanguage(entry) : entry
    ),
    phone: migratePhone(legacy.phone),
    workAuthorization: legacy.workAuthorization.map((entry) =>
      typeof entry === "string"
        ? {
            country: entry,
            expiresAt: "",
            status: entry === "United States" ? "citizen" : "work-permit",
          }
        : entry
    ),
  });
}

export function migratePreferencesV1(input: unknown): Preferences {
  const legacy = LegacyPreferencesSchema.parse(input);
  const { preschool } = legacy.audiences;
  return PreferencesSchema.parse({
    audiences: {
      adults: rule(
        legacy.audiences.adults,
        defaultPreferences.audiences.adults
      ),
      college: rule(
        legacy.audiences.college,
        defaultPreferences.audiences.college
      ),
      // The prior compatibility transform rewrote the known `avoid` default to
      // `exclude`. Version 1 has one owner row and no way to represent that loss,
      // so the versioned migration repairs that exact legacy default.
      preschool: preschool === "exclude" ? "avoid" : rule(preschool, "avoid"),
      primary: rule(
        legacy.audiences.primary,
        defaultPreferences.audiences.primary
      ),
      teenagers: rule(
        legacy.audiences.teenagers,
        defaultPreferences.audiences.teenagers
      ),
    },
    benefits: {
      airfare: benefit(legacy.benefits.airfare),
      healthInsurance: benefit(legacy.benefits.healthInsurance),
      housing: benefit(legacy.benefits.housing),
      paidLeave: benefit(legacy.benefits.paidLeave),
      professionalDevelopment: benefit(legacy.benefits.professionalDevelopment),
      visaSponsorship: benefit(legacy.benefits.visaSponsorship),
    },
    countries: legacy.countries,
    employment: {
      contract: rule(
        legacy.employment.contract,
        defaultPreferences.employment.contract
      ),
      fullTime: rule(
        legacy.employment.fullTime,
        defaultPreferences.employment.fullTime
      ),
      partTime: rule(
        legacy.employment.partTime,
        defaultPreferences.employment.partTime
      ),
    },
    minimumMonthlyUsd: legacy.minimumMonthlyUsd,
  });
}

function rule(
  value: z.infer<typeof legacyRuleStrength> | undefined,
  fallback: RuleStrength
): RuleStrength {
  return value ?? fallback;
}

function benefit(
  value: z.infer<typeof legacyBenefitStrength> | undefined
): "accept" | "prefer" | "required" {
  if (value === "required" || value === "prefer") {
    return value;
  }
  return "accept";
}

function migrateEducation(value: string) {
  const [qualification = value, institution = ""] = value.split(" — ");
  const match = qualification.match(
    /^(Associate|Bachelor|Master|Doctor)(?: of (.+?))? in (.*)$/i
  );
  let level: z.infer<typeof DegreeLevelSchema> = "bachelor";
  if (/associate/i.test(qualification)) {
    level = "associate";
  } else if (/master/i.test(qualification)) {
    level = "master";
  } else if (/doctor/i.test(qualification)) {
    level = "doctorate";
  }
  return {
    country: /west virginia university/i.test(institution)
      ? "United States"
      : "",
    degree: match
      ? `${match[1]}${match[2] ? ` of ${match[2]}` : ""}`
      : qualification,
    field: match?.[3] ?? "",
    institution,
    level,
  };
}

function migrateLanguage(value: string) {
  const [language = value, level = ""] = value.split(" — ");
  const normalized = level.toLowerCase().includes("native")
    ? "native"
    : (level.toUpperCase().match(/A1|A2|B1|B2|C1|C2/)?.[0] ?? "B2");
  return LanguageEntrySchema.parse({ language, level: normalized });
}

function migratePhone(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  const digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+")) {
    return `+${digits}`;
  }
  return digits.length === 10 ? `+1${digits}` : `+${digits}`;
}
