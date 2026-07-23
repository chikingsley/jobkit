import type { CountrySweepTaskOutput } from "../../../src/features/countries/schema";
import type { CountryTaskLeaseContext } from "../agent-tasks/country-sweep-leases";
import { sha256 } from "../agent-tasks/run-store";
import {
  type CompletionTaskRow,
  type NormalizedContact,
  type NormalizedOrganization,
  WWW_PREFIX_PATTERN,
} from "./model";

export function normalizeOrganizations(
  organizations: CountrySweepTaskOutput["organizations"]
) {
  const unique = new Map<string, NormalizedOrganization>();
  for (const organization of organizations) {
    const canonicalDomain = normalizeDomain(
      organization.canonicalDomain || organization.websiteUrl
    );
    const identityKey = canonicalDomain
      ? `domain:${canonicalDomain}`
      : `name:${normalizeIdentity(organization.name)}|city:${normalizeIdentity(
          organization.city
        )}`;
    const contacts = new Map<string, NormalizedContact>();
    for (const contact of organization.contactPoints) {
      const value =
        contact.kind === "email"
          ? contact.value.trim().toLowerCase()
          : contact.value.trim();
      contacts.set(`${contact.kind}:${value}`, {
        evidenceUrl: contact.evidenceUrl.trim(),
        id: crypto.randomUUID(),
        kind: contact.kind,
        label: contact.label.trim(),
        status: contact.status,
        value,
      });
    }
    unique.set(identityKey, {
      canonicalDomain,
      city: organization.city.trim(),
      contactPoints: [...contacts.values()],
      evidenceId: crypto.randomUUID(),
      evidenceUrl: organization.evidenceUrl.trim(),
      id: crypto.randomUUID(),
      identityKey,
      lastVerifiedAt: organization.lastVerifiedAt,
      marketSegment: organization.marketSegment,
      name: organization.name.trim(),
      outreachEligibility: organization.outreachEligibility,
      region: organization.region.trim(),
      status: organization.status,
      websiteUrl: organization.websiteUrl.trim(),
    });
  }
  return [...unique.values()];
}

export function prepareVerificationTasks(
  task: CompletionTaskRow,
  organizations: NormalizedOrganization[]
) {
  return Promise.all(
    organizations.map(async (organization) => {
      const inputJson = JSON.stringify({
        countryCode: task.country_code,
        countryName: task.country_name,
        organization: {
          canonicalDomain: organization.canonicalDomain,
          city: organization.city,
          evidenceUrl: organization.evidenceUrl,
          identityKey: organization.identityKey,
          marketSegment: organization.marketSegment,
          name: organization.name,
          outreachEligibility: organization.outreachEligibility,
          region: organization.region,
          status: organization.status,
          websiteUrl: organization.websiteUrl,
        },
        phase: "verification",
      });
      return {
        id: crypto.randomUUID(),
        inputHash: await sha256(inputJson),
        inputJson,
        scopeKey: organization.identityKey,
      };
    })
  );
}

export function prepareDiscoveryTasks(
  task: CompletionTaskRow,
  scopes: CountrySweepTaskOutput["coverageSummary"]["nextScopes"]
) {
  const uniqueScopes = new Map(
    scopes.map((scope) => [discoveryScopeKey(scope), scope])
  );
  return Promise.all(
    [...uniqueScopes].map(async ([scopeKey, scope]) => {
      const inputJson = JSON.stringify({
        city: scope.city,
        countryCode: task.country_code,
        countryName: task.country_name,
        phase: "discovery",
        query: scope.query,
        source: scope.source,
      });
      return {
        id: crypto.randomUUID(),
        inputHash: await sha256(inputJson),
        inputJson,
        scopeKey,
      };
    })
  );
}

export async function prepareAuditTask(
  task: CompletionTaskRow,
  context: CountryTaskLeaseContext
) {
  const inputJson = JSON.stringify({
    countryCode: task.country_code,
    countryName: task.country_name,
    phase: "coverage_audit",
    progress: { completedTaskId: context.taskId },
  });
  return {
    id: crypto.randomUUID(),
    inputHash: await sha256(inputJson),
    inputJson,
    scopeKey: `coverage:after:${context.taskId}`,
  };
}

function discoveryScopeKey(
  scope: CountrySweepTaskOutput["coverageSummary"]["nextScopes"][number]
) {
  return [
    scope.source,
    normalizeIdentity(scope.city),
    normalizeIdentity(scope.query),
  ]
    .filter(Boolean)
    .join(":");
}

function normalizeDomain(value: string) {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) {
    return "";
  }
  try {
    const url = new URL(
      trimmed.includes("://") ? trimmed : `https://${trimmed}`
    );
    return url.hostname.replace(WWW_PREFIX_PATTERN, "");
  } catch {
    return "";
  }
}

function normalizeIdentity(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replaceAll(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replaceAll(/^-|-$/gu, "");
}

export function requiredChangesAssertionStatement(
  db: D1Database,
  expectedChanges: number
) {
  return db
    .prepare(
      `INSERT INTO transaction_assertions(must_equal_one)
       SELECT 0 WHERE changes()<>?`
    )
    .bind(expectedChanges);
}
