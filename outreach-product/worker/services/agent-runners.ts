import { z } from "zod";
import {
  type AgentCapability,
  AgentCapabilitySchema,
} from "../../src/features/agents/schema";
import type { AgentRunnerContext } from "../app-types";

const BEARER_PREFIX_PATTERN = /^Bearer\s+/iu;
const PAIRING_LIFETIME_MS = 10 * 60 * 1000;
const RUNNER_ONLINE_WINDOW_MS = 60 * 1000;
const CAPABILITIES_SCHEMA = z.array(AgentCapabilitySchema).min(1);

interface AgentRunnerRow {
  capabilities_json: string;
  codex_version: string;
  email: string;
  id: string;
  name: string;
  role: "member" | "operator";
  user_id: string;
  user_name: string;
}

export async function createAgentRunnerPairing(
  db: D1Database,
  userId: string,
  capabilities: AgentCapability[]
) {
  const code = `jobkit_pair_${randomHex(16)}`;
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + PAIRING_LIFETIME_MS).toISOString();
  await db
    .prepare(
      `INSERT INTO agent_runner_pairings
        (id,user_id,code_hash,capabilities_json,expires_at,created_at)
       VALUES (?,?,?,?,?,?)`
    )
    .bind(
      crypto.randomUUID(),
      userId,
      await sha256(code),
      JSON.stringify(capabilities),
      expiresAt,
      createdAt
    )
    .run();
  return { code, createdAt, expiresAt };
}

export async function exchangeAgentRunnerPairing(
  db: D1Database,
  code: string,
  runnerName: string,
  codexVersion: string
) {
  const timestamp = new Date().toISOString();
  const pairing = await db
    .prepare(
      `UPDATE agent_runner_pairings
          SET consumed_at=?
        WHERE code_hash=? AND consumed_at IS NULL AND expires_at>?
      RETURNING user_id,capabilities_json`
    )
    .bind(timestamp, await sha256(code.trim()), timestamp)
    .first<{ capabilities_json: string; user_id: string }>();
  if (!pairing) {
    return null;
  }

  const capabilities = CAPABILITIES_SCHEMA.parse(
    JSON.parse(pairing.capabilities_json)
  );
  const runnerId = crypto.randomUUID();
  const token = `jobkit_agent_${randomHex(32)}`;
  await db
    .prepare(
      `INSERT INTO agent_runners
        (id,user_id,name,token_hash,capabilities_json,codex_version,
         last_seen_at,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?)`
    )
    .bind(
      runnerId,
      pairing.user_id,
      runnerName.trim(),
      await sha256(token),
      JSON.stringify(capabilities),
      codexVersion.trim(),
      timestamp,
      timestamp,
      timestamp
    )
    .run();
  return { capabilities, runnerId, token };
}

export async function authenticateAgentRunner(
  db: D1Database,
  authorization: string
): Promise<AgentRunnerContext | null> {
  const token = authorization.replace(BEARER_PREFIX_PATTERN, "").trim();
  if (!token.startsWith("jobkit_agent_") || token.length < 40) {
    return null;
  }
  const row = await db
    .prepare(
      `SELECT r.id,r.user_id,r.name,r.capabilities_json,r.codex_version,
              u.email,u.name user_name,u.role
         FROM agent_runners r
         JOIN users u ON u.id=r.user_id
        WHERE r.token_hash=? AND r.revoked_at IS NULL`
    )
    .bind(await sha256(token))
    .first<AgentRunnerRow>();
  if (!row) {
    return null;
  }
  await touchAgentRunner(db, row.id);
  return {
    capabilities: CAPABILITIES_SCHEMA.parse(JSON.parse(row.capabilities_json)),
    codexVersion: row.codex_version,
    id: row.id,
    name: row.name,
    user: {
      email: row.email,
      id: row.user_id,
      name: row.user_name,
      role: row.role,
    },
  };
}

export async function listAgentRunners(db: D1Database, userId: string) {
  const rows = await db
    .prepare(
      `SELECT id,name,capabilities_json,codex_version,last_seen_at,revoked_at,
              created_at
         FROM agent_runners
        WHERE user_id=? ORDER BY created_at DESC`
    )
    .bind(userId)
    .all<{
      capabilities_json: string;
      codex_version: string;
      created_at: string;
      id: string;
      last_seen_at: string | null;
      name: string;
      revoked_at: string | null;
    }>();
  return rows.results.map((row) => ({
    capabilities: CAPABILITIES_SCHEMA.parse(JSON.parse(row.capabilities_json)),
    codexVersion: row.codex_version,
    createdAt: row.created_at,
    id: row.id,
    lastSeenAt: row.last_seen_at,
    name: row.name,
    revokedAt: row.revoked_at,
  }));
}

export async function hasAgentRunnerCapability(
  db: D1Database,
  userId: string,
  capability: AgentCapability
) {
  const rows = await db
    .prepare(
      `SELECT capabilities_json FROM agent_runners
        WHERE user_id=? AND revoked_at IS NULL AND last_seen_at>=?`
    )
    .bind(userId, new Date(Date.now() - RUNNER_ONLINE_WINDOW_MS).toISOString())
    .all<{ capabilities_json: string }>();
  return rows.results.some((row) =>
    CAPABILITIES_SCHEMA.parse(JSON.parse(row.capabilities_json)).includes(
      capability
    )
  );
}

export async function revokeAgentRunner(
  db: D1Database,
  userId: string,
  runnerId: string
) {
  const timestamp = new Date().toISOString();
  const [runnerResult] = await db.batch([
    db
      .prepare(
        `UPDATE agent_runners SET revoked_at=?,updated_at=?
          WHERE id=? AND user_id=? AND revoked_at IS NULL`
      )
      .bind(timestamp, timestamp, runnerId, userId),
    db
      .prepare(
        `UPDATE agent_task_runs
            SET status='failed',error_detail='Runner revoked',
                completed_at=?,updated_at=?
          WHERE runner_id=? AND user_id=? AND status='running'`
      )
      .bind(timestamp, timestamp, runnerId, userId),
    db
      .prepare(
        `UPDATE test_lab_runs
            SET status='queued',started_at=NULL,
                error_detail='Runner revoked; task requeued',updated_at=?
          WHERE user_id=? AND status='running' AND agent_task_request_id IN (
            SELECT id FROM agent_task_requests
             WHERE runner_id=? AND user_id=? AND status='claimed'
          )`
      )
      .bind(timestamp, userId, runnerId, userId),
    db
      .prepare(
        `UPDATE agent_task_requests
            SET status='queued',runner_id=NULL,claimed_at=NULL,
                lease_expires_at=NULL,error_detail='Runner revoked; task requeued',
                updated_at=?
          WHERE runner_id=? AND user_id=? AND status='claimed'`
      )
      .bind(timestamp, runnerId, userId),
  ]);
  return (runnerResult?.meta.changes ?? 0) === 1;
}

export async function updateAgentRunnerVersion(
  db: D1Database,
  runnerId: string,
  codexVersion: string
) {
  const version = codexVersion.trim();
  if (!version) {
    return;
  }
  const timestamp = new Date().toISOString();
  await db
    .prepare("UPDATE agent_runners SET codex_version=?,updated_at=? WHERE id=?")
    .bind(version, timestamp, runnerId)
    .run();
}

export function agentRunnerHasCapability(
  runner: AgentRunnerContext,
  capability: AgentCapability
) {
  return runner.capabilities.includes(capability);
}

async function touchAgentRunner(db: D1Database, runnerId: string) {
  const timestamp = new Date().toISOString();
  await db
    .prepare("UPDATE agent_runners SET last_seen_at=?,updated_at=? WHERE id=?")
    .bind(timestamp, timestamp, runnerId)
    .run();
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
