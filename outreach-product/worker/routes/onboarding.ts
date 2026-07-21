import { profileFromImport } from "../../src/features/onboarding/schema";
import { defaultProfile } from "../../src/features/profile/schema";
import type { JobKitApp } from "../app-types";
import {
  completeOnboarding,
  readLatestProfileImport,
  readOnboardingCompletion,
} from "../repositories/onboarding";
import { listUserDocuments } from "../repositories/user-documents";
import { readPreferences, readProfile } from "../repositories/user-settings";
import { importResume } from "../services/profile-imports";

const WHITESPACE_PATTERN = /\s+/u;

export function registerOnboardingRoutes(app: JobKitApp) {
  app.get("/api/onboarding", async (c) => {
    const user = c.get("user");
    const [completedAt, profile, preferences, profileImport, documents] =
      await Promise.all([
        readOnboardingCompletion(c.env.DB, user.id),
        readProfile(c.env.DB, user.id),
        readPreferences(c.env.DB, user.id),
        readLatestProfileImport(c.env.DB, user.id),
        listUserDocuments(c.env.DB, user.id),
      ]);
    const importedProfile = profileImport?.proposal
      ? profileFromImport(profileImport.proposal, user)
      : null;
    return c.json({
      completedAt,
      documents,
      hasPreferences: preferences.updatedAt !== null,
      hasProfile: profile.updatedAt !== null,
      preferences: preferences.value,
      profile:
        profile.updatedAt === null
          ? (importedProfile ?? {
              ...defaultProfile,
              email: user.email,
              fullName: user.name,
              preferredName:
                user.name.split(WHITESPACE_PATTERN)[0] ?? user.name,
            })
          : profile.value,
      profileImport,
    });
  });

  app.put("/api/profile-imports", async (c) => {
    const result = await importResume(c.env, c.get("user"), c.req.raw);
    return c.json(result, 202);
  });

  app.post("/api/onboarding/complete", async (c) => {
    const completedAt = await completeOnboarding(c.env.DB, c.get("user").id);
    return c.json({ completedAt, message: "Onboarding complete", ok: true });
  });
}
