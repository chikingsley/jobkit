import type { AuthUser } from "../app-types";

interface RunnerUserRow {
  email: string;
  id: string;
  name: string;
  token_id: string;
}

const BEARER_PREFIX_PATTERN = /^Bearer\s+/iu;

export async function authenticateCountrySweepRunner(
  db: D1Database,
  authorization: string
): Promise<AuthUser | null> {
  const token = authorization.replace(BEARER_PREFIX_PATTERN, "").trim();
  if (!token.startsWith("jobkit_runner_") || token.length < 40) {
    return null;
  }
  const tokenHash = await sha256(token);
  const row = await db
    .prepare(
      `SELECT u.id,u.email,u.name,t.id token_id
         FROM country_sweep_runner_tokens t
         JOIN users u ON u.id=t.user_id
        WHERE t.token_hash=? AND t.revoked_at IS NULL`
    )
    .bind(tokenHash)
    .first<RunnerUserRow>();
  if (!row) {
    return null;
  }
  await db
    .prepare("UPDATE country_sweep_runner_tokens SET last_used_at=? WHERE id=?")
    .bind(new Date().toISOString(), row.token_id)
    .run();
  return { email: row.email, id: row.id, name: row.name };
}

export async function createCountrySweepRunnerToken(
  db: D1Database,
  userId: string,
  name: string
) {
  const token = `jobkit_runner_${randomHex(32)}`;
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO country_sweep_runner_tokens
        (id,user_id,name,token_hash,created_at) VALUES (?,?,?,?,?)`
    )
    .bind(id, userId, name.trim(), await sha256(token), createdAt)
    .run();
  return { createdAt, id, name: name.trim(), token };
}

export async function listCountrySweepRunnerTokens(
  db: D1Database,
  userId: string
) {
  const rows = await db
    .prepare(
      `SELECT id,name,last_used_at,revoked_at,created_at
         FROM country_sweep_runner_tokens
        WHERE user_id=? ORDER BY created_at DESC`
    )
    .bind(userId)
    .all<{
      created_at: string;
      id: string;
      last_used_at: string | null;
      name: string;
      revoked_at: string | null;
    }>();
  return rows.results.map((row) => ({
    createdAt: row.created_at,
    id: row.id,
    lastUsedAt: row.last_used_at,
    name: row.name,
    revokedAt: row.revoked_at,
  }));
}

export async function revokeCountrySweepRunnerToken(
  db: D1Database,
  userId: string,
  tokenId: string
) {
  const result = await db
    .prepare(
      `UPDATE country_sweep_runner_tokens SET revoked_at=?
        WHERE id=? AND user_id=? AND revoked_at IS NULL`
    )
    .bind(new Date().toISOString(), tokenId, userId)
    .run();
  return (result.meta.changes ?? 0) === 1;
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function randomHex(byteCount: number) {
  const bytes = crypto.getRandomValues(new Uint8Array(byteCount));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
