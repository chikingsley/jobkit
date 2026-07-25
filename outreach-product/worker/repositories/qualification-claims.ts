import { and, desc, eq } from "drizzle-orm";
import type {
  QualificationClaim,
  QualificationClaimAnswer,
  QualificationClaims,
} from "../../src/pipeline/03_match/claims";
import { excluded, getDb } from "../db/client";
import { userQualificationClaims } from "../db/schema/user-profile";

export async function readQualificationClaims(
  db: D1Database,
  userId: string
): Promise<QualificationClaims> {
  const rows = await getDb(db)
    .select({
      answer: userQualificationClaims.answer,
      claimKey: userQualificationClaims.claimKey,
      kind: userQualificationClaims.kind,
      label: userQualificationClaims.label,
      updatedAt: userQualificationClaims.updatedAt,
    })
    .from(userQualificationClaims)
    .where(eq(userQualificationClaims.userId, userId))
    .orderBy(desc(userQualificationClaims.updatedAt));
  return Object.fromEntries(
    rows.map((row) => {
      const claim: QualificationClaim = {
        answer: row.answer as QualificationClaimAnswer,
        claimKey: row.claimKey,
        kind: row.kind,
        label: row.label,
        updatedAt: row.updatedAt,
      };
      return [row.claimKey, claim];
    })
  );
}

export async function writeQualificationClaim(
  db: D1Database,
  userId: string,
  input: {
    answer: QualificationClaimAnswer | null;
    claimKey: string;
    kind: string;
    label: string;
  }
): Promise<QualificationClaim | null> {
  if (input.answer === null) {
    await getDb(db)
      .delete(userQualificationClaims)
      .where(
        and(
          eq(userQualificationClaims.userId, userId),
          eq(userQualificationClaims.claimKey, input.claimKey)
        )
      )
      .run();
    return null;
  }
  const timestamp = new Date().toISOString();
  await getDb(db)
    .insert(userQualificationClaims)
    .values({
      answer: input.answer,
      claimKey: input.claimKey,
      createdAt: timestamp,
      kind: input.kind,
      label: input.label,
      updatedAt: timestamp,
      userId,
    })
    .onConflictDoUpdate({
      set: {
        answer: excluded(userQualificationClaims.answer),
        kind: excluded(userQualificationClaims.kind),
        label: excluded(userQualificationClaims.label),
        updatedAt: excluded(userQualificationClaims.updatedAt),
      },
      target: [
        userQualificationClaims.userId,
        userQualificationClaims.claimKey,
      ],
    })
    .run();
  return {
    answer: input.answer,
    claimKey: input.claimKey,
    kind: input.kind,
    label: input.label,
    updatedAt: timestamp,
  };
}
