import { localDevelopmentUser } from "../../src/features/auth/local-development";
import {
  defaultPreferences,
  PREFERENCES_SCHEMA_VERSION,
} from "../../src/features/preferences/schema";
import {
  defaultProfile,
  PROFILE_SCHEMA_VERSION,
} from "../../src/features/profile/schema";

export async function ensureLocalDevelopmentUser(db: D1Database) {
  const timestamp = new Date().toISOString();
  const profile = {
    ...defaultProfile,
    citizenship: "United States",
    currentLocation: "Phoenix, United States",
    email: localDevelopmentUser.email,
    fullName: localDevelopmentUser.name,
    preferredName: "Local",
  };

  await db.batch([
    db
      .prepare(
        `INSERT INTO users
           (id,name,email,email_verified,image,created_at,updated_at,role)
         VALUES (?,?,?,1,NULL,?,?,'operator')
         ON CONFLICT(id) DO NOTHING`
      )
      .bind(
        localDevelopmentUser.id,
        localDevelopmentUser.name,
        localDevelopmentUser.email,
        timestamp,
        timestamp
      ),
    db
      .prepare(
        `INSERT INTO user_profiles
           (id,user_id,profile_json,updated_at,schema_version)
         VALUES (?,?,?,?,?)
         ON CONFLICT(user_id) DO NOTHING`
      )
      .bind(
        crypto.randomUUID(),
        localDevelopmentUser.id,
        JSON.stringify(profile),
        timestamp,
        PROFILE_SCHEMA_VERSION
      ),
    db
      .prepare(
        `INSERT INTO user_preferences
           (id,user_id,preferences_json,updated_at,schema_version)
         VALUES (?,?,?,?,?)
         ON CONFLICT(user_id) DO NOTHING`
      )
      .bind(
        crypto.randomUUID(),
        localDevelopmentUser.id,
        JSON.stringify(defaultPreferences),
        timestamp,
        PREFERENCES_SCHEMA_VERSION
      ),
    db
      .prepare(
        `INSERT INTO user_onboarding (user_id,completed_at,updated_at)
         VALUES (?,?,?)
         ON CONFLICT(user_id) DO NOTHING`
      )
      .bind(localDevelopmentUser.id, timestamp, timestamp),
  ]);

  return localDevelopmentUser;
}
