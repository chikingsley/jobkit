import { and, desc, eq, gt, gte, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import {
  type AgentCapability,
  AgentCapabilitySchema,
} from "../../src/features/agents/schema";
import type { AgentRunnerContext } from "../app-types";
import { getDb } from "../db/client";
import { agentRunnerPairings, agentRunners } from "../db/schema/agent-tasks";
import { users } from "../db/schema/auth";

const BEARER_PREFIX_PATTERN = /^Bearer\s+/iu;
const PAIRING_LIFETIME_MS = 10 * 60 * 1000;
const RUNNER_ONLINE_WINDOW_MS = 60 * 1000;
const CAPABILITIES_SCHEMA = z.array(AgentCapabilitySchema).min(1);

export async function createAgentRunnerPairing(
  db: D1Database,
  userId: string,
  capabilities: AgentCapability[]
) {
  const code = `jobkit_pair_${randomHex(16)}`;
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + PAIRING_LIFETIME_MS).toISOString();
  await getDb(db)
    .insert(agentRunnerPairings)
    .values({
      capabilitiesJson: JSON.stringify(capabilities),
      codeHash: await sha256(code),
      createdAt,
      expiresAt,
      id: crypto.randomUUID(),
      userId,
    })
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
  const pairing = await getDb(db)
    .update(agentRunnerPairings)
    .set({ consumedAt: timestamp })
    .where(
      and(
        eq(agentRunnerPairings.codeHash, await sha256(code.trim())),
        isNull(agentRunnerPairings.consumedAt),
        gt(agentRunnerPairings.expiresAt, timestamp)
      )
    )
    .returning({
      capabilitiesJson: agentRunnerPairings.capabilitiesJson,
      userId: agentRunnerPairings.userId,
    })
    .get();
  if (!pairing) {
    return null;
  }

  const capabilities = CAPABILITIES_SCHEMA.parse(
    JSON.parse(pairing.capabilitiesJson)
  );
  const runnerId = crypto.randomUUID();
  const token = `jobkit_agent_${randomHex(32)}`;
  await getDb(db)
    .insert(agentRunners)
    .values({
      capabilitiesJson: JSON.stringify(capabilities),
      codexVersion: codexVersion.trim(),
      createdAt: timestamp,
      id: runnerId,
      lastSeenAt: timestamp,
      name: runnerName.trim(),
      tokenHash: await sha256(token),
      updatedAt: timestamp,
      userId: pairing.userId,
    })
    .run();
  return { capabilities, runnerId, token };
}

export async function authenticateAgentRunner(
  db: D1Database,
  authorization: string
): Promise<AgentRunnerContext | null> {
  const token = authorization.replace(BEARER_PREFIX_PATTERN, "").trim();
  if (!(token.startsWith("jobkit_agent_") && token.length >= 40)) {
    return null;
  }
  const row = await getDb(db)
    .select({
      capabilitiesJson: agentRunners.capabilitiesJson,
      codexVersion: agentRunners.codexVersion,
      email: users.email,
      id: agentRunners.id,
      name: agentRunners.name,
      role: users.role,
      userId: agentRunners.userId,
      userName: users.name,
    })
    .from(agentRunners)
    .innerJoin(users, eq(users.id, agentRunners.userId))
    .where(
      and(
        eq(agentRunners.tokenHash, await sha256(token)),
        isNull(agentRunners.revokedAt)
      )
    )
    .get();
  if (!row) {
    return null;
  }
  await touchAgentRunner(db, row.id);
  return {
    capabilities: CAPABILITIES_SCHEMA.parse(JSON.parse(row.capabilitiesJson)),
    codexVersion: row.codexVersion,
    id: row.id,
    name: row.name,
    user: {
      email: row.email,
      id: row.userId,
      name: row.userName,
      role: row.role as "member" | "operator",
    },
  };
}

export async function listAgentRunners(db: D1Database, userId: string) {
  const rows = await getDb(db)
    .select({
      capabilitiesJson: agentRunners.capabilitiesJson,
      codexVersion: agentRunners.codexVersion,
      createdAt: agentRunners.createdAt,
      id: agentRunners.id,
      lastSeenAt: agentRunners.lastSeenAt,
      name: agentRunners.name,
      revokedAt: agentRunners.revokedAt,
    })
    .from(agentRunners)
    .where(eq(agentRunners.userId, userId))
    .orderBy(desc(agentRunners.createdAt));
  return rows.map((row) => ({
    capabilities: CAPABILITIES_SCHEMA.parse(JSON.parse(row.capabilitiesJson)),
    codexVersion: row.codexVersion,
    createdAt: row.createdAt,
    id: row.id,
    lastSeenAt: row.lastSeenAt,
    name: row.name,
    revokedAt: row.revokedAt,
  }));
}

export async function hasAgentRunnerCapability(
  db: D1Database,
  userId: string,
  capability: AgentCapability
) {
  const rows = await getDb(db)
    .select({ capabilitiesJson: agentRunners.capabilitiesJson })
    .from(agentRunners)
    .where(
      and(
        eq(agentRunners.userId, userId),
        isNull(agentRunners.revokedAt),
        gte(
          agentRunners.lastSeenAt,
          new Date(Date.now() - RUNNER_ONLINE_WINDOW_MS).toISOString()
        )
      )
    );
  return rows.some((row) =>
    CAPABILITIES_SCHEMA.parse(JSON.parse(row.capabilitiesJson)).includes(
      capability
    )
  );
}

export async function revokeAgentRunner(
  db: D1Database,
  userId: string,
  runnerId: string
) {
  const now = sql`strftime('%Y-%m-%dT%H:%M:%fZ','now')`;
  const runnerResult = await getDb(db)
    .update(agentRunners)
    .set({ revokedAt: now, updatedAt: now })
    .where(
      and(
        eq(agentRunners.id, runnerId),
        eq(agentRunners.userId, userId),
        isNull(agentRunners.revokedAt)
      )
    )
    .run();
  return (runnerResult.meta.changes ?? 0) === 1;
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
  await getDb(db)
    .update(agentRunners)
    .set({ codexVersion: version, updatedAt: timestamp })
    .where(eq(agentRunners.id, runnerId))
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
  await getDb(db)
    .update(agentRunners)
    .set({ lastSeenAt: timestamp, updatedAt: timestamp })
    .where(eq(agentRunners.id, runnerId))
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
