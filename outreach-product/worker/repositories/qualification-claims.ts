import type {
  QualificationClaim,
  QualificationClaimAnswer,
  QualificationClaims,
} from "../../src/features/matching/claims";

interface ClaimRow {
  answer: QualificationClaimAnswer;
  claim_key: string;
  kind: string;
  label: string;
  updated_at: string;
}

export async function readQualificationClaims(
  db: D1Database,
  userId: string
): Promise<QualificationClaims> {
  const rows = await db
    .prepare(
      `SELECT claim_key,label,kind,answer,updated_at
         FROM user_qualification_claims
        WHERE user_id=? ORDER BY updated_at DESC`
    )
    .bind(userId)
    .all<ClaimRow>();
  return Object.fromEntries(
    rows.results.map((row) => {
      const claim: QualificationClaim = {
        answer: row.answer,
        claimKey: row.claim_key,
        kind: row.kind,
        label: row.label,
        updatedAt: row.updated_at,
      };
      return [row.claim_key, claim];
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
    await db
      .prepare(
        "DELETE FROM user_qualification_claims WHERE user_id=? AND claim_key=?"
      )
      .bind(userId, input.claimKey)
      .run();
    return null;
  }
  const timestamp = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO user_qualification_claims
        (user_id,claim_key,label,kind,answer,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(user_id,claim_key) DO UPDATE SET
         label=excluded.label,kind=excluded.kind,answer=excluded.answer,
         updated_at=excluded.updated_at`
    )
    .bind(
      userId,
      input.claimKey,
      input.label,
      input.kind,
      input.answer,
      timestamp,
      timestamp
    )
    .run();
  return {
    answer: input.answer,
    claimKey: input.claimKey,
    kind: input.kind,
    label: input.label,
    updatedAt: timestamp,
  };
}
