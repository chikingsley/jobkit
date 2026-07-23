import { getCountries } from "libphonenumber-js";
import { z } from "zod";
import {
  type CountrySweepRequest,
  MAX_COUNTRY_SWEEP_CITIES,
  normalizeCountrySweepCities,
} from "../../src/features/countries/schema";
import type {
  CountryDetail,
  CountryMarketSummary,
  CountryOpportunitySummary,
  CountryOrganizationSummary,
  CountrySweepSummary,
} from "../../src/features/countries/types";
import {
  countrySweepScopeKey,
  countrySweepSha256,
  requestedSweepCities,
} from "./country-markets/support";

interface CountryCountRow {
  count: number;
  country_code?: string;
  country_name: string;
  latest_at?: string | null;
  latest_status?: string | null;
}

interface SweepRow {
  completed_at: string | null;
  id: string;
  requested_at: string;
  status: string;
}

const countryDisplayNames = new Intl.DisplayNames(["en"], { type: "region" });
const countryNamesByCode = new Map(
  getCountries().map((code) => [code, countryDisplayNames.of(code) ?? code])
);
const countryCodesByName = new Map(
  [...countryNamesByCode].map(([code, name]) => [name.toLowerCase(), code])
);

const COUNTRY_NAME_ALIASES = new Map([
  ["czech republic", "CZ"],
  ["iran", "IR"],
  ["russia", "RU"],
  ["south korea", "KR"],
  ["taiwan", "TW"],
]);
const D1_ROW_SCHEMA = z.record(z.string(), z.unknown());
const MAX_D1_BOUND_VALUE_BYTES = 2_000_000;

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

export class CountryMarketError extends Error {
  readonly status: 400 | 403 | 404 | 409;

  constructor(message: string, status: 400 | 403 | 404 | 409) {
    super(message);
    this.status = status;
  }
}

export function countryNameForCode(rawCode: string): string {
  const code = rawCode.trim().toUpperCase();
  const name = countryNamesByCode.get(
    code as ReturnType<typeof getCountries>[number]
  );
  if (!name) {
    throw new CountryMarketError("Country code is not supported", 404);
  }
  return name;
}

function countryCodeForName(name: string) {
  const normalized = name.trim().toLowerCase();
  return (
    COUNTRY_NAME_ALIASES.get(normalized) ?? countryCodesByName.get(normalized)
  );
}

export function countryNamesForCode(countryCode: string) {
  const canonicalName = countryNameForCode(countryCode);
  const aliases = [...COUNTRY_NAME_ALIASES]
    .filter(([, code]) => code === countryCode)
    .map(([name]) => name);
  return [...new Set([canonicalName.toLowerCase(), ...aliases])];
}

export async function listCountryMarkets(
  db: D1Database,
  userId: string
): Promise<CountryMarketSummary[]> {
  const [jobCounts, organizationCounts, contactCounts, campaignCounts, sweeps] =
    await db.batch<CountryCountRow>([
      db.prepare(
        `SELECT country country_name,COUNT(*) count
           FROM job_listings
          WHERE inventory_status='active' AND trim(country)<>''
          GROUP BY lower(country),country`
      ),
      db.prepare(
        `SELECT country_code,country_name,COUNT(*) count
           FROM organizations
          WHERE status NOT IN ('closed','invalid')
          GROUP BY country_code,country_name`
      ),
      db.prepare(
        `SELECT o.country_code,o.country_name,COUNT(*) count
           FROM organization_contact_points cp
           JOIN organizations o ON o.id=cp.organization_id
          WHERE cp.status='active'
            AND cp.kind IN ('email','phone','contact_form')
          GROUP BY o.country_code,o.country_name`
      ),
      db
        .prepare(
          `SELECT cm.country_code,cm.country_name,
                  COUNT(DISTINCT cm.campaign_id) count
             FROM campaign_markets cm
             JOIN campaigns c ON c.id=cm.campaign_id
            WHERE c.user_id=?
            GROUP BY cm.country_code,cm.country_name`
        )
        .bind(userId),
      db.prepare(
        `SELECT s.country_code,s.country_name,COUNT(*) count,
                MAX(s.requested_at) latest_at,
                (
                  SELECT latest.status FROM country_sweeps latest
                   WHERE latest.country_code=s.country_code
                   ORDER BY latest.requested_at DESC LIMIT 1
                ) latest_status
           FROM country_sweeps s
          GROUP BY s.country_code,s.country_name`
      ),
    ]);
  if (
    !(
      jobCounts &&
      organizationCounts &&
      contactCounts &&
      campaignCounts &&
      sweeps
    )
  ) {
    throw new Error("Country market summaries could not be loaded");
  }

  const summaries = new Map<string, CountryMarketSummary>();
  const read = (code: string, name: string) => {
    const existing = summaries.get(code);
    if (existing) {
      return existing;
    }
    const created: CountryMarketSummary = {
      campaignCount: 0,
      countryCode: code,
      countryName: name,
      latestSweepAt: null,
      latestSweepStatus: null,
      openPositionCount: 0,
      organizationCount: 0,
      verifiedContactCount: 0,
    };
    summaries.set(code, created);
    return created;
  };

  for (const row of jobCounts.results) {
    const code = countryCodeForName(row.country_name);
    if (code) {
      read(code, countryNameForCode(code)).openPositionCount += Number(
        row.count
      );
    }
  }
  for (const row of organizationCounts.results) {
    read(String(row.country_code), row.country_name).organizationCount = Number(
      row.count
    );
  }
  for (const row of contactCounts.results) {
    read(String(row.country_code), row.country_name).verifiedContactCount =
      Number(row.count);
  }
  for (const row of campaignCounts.results) {
    read(String(row.country_code), row.country_name).campaignCount = Number(
      row.count
    );
  }
  for (const row of sweeps.results) {
    const summary = read(String(row.country_code), row.country_name);
    summary.latestSweepAt = row.latest_at ?? null;
    summary.latestSweepStatus = row.latest_status ?? null;
  }

  return [...summaries.values()].sort((left, right) =>
    left.countryName.localeCompare(right.countryName)
  );
}

export async function readCountryDetail(
  db: D1Database,
  userId: string,
  countryCode: string
): Promise<CountryDetail> {
  const countryName = countryNameForCode(countryCode);
  const jobCountryNames = countryNamesForCode(countryCode);
  const jobCountryPlaceholders = jobCountryNames.map(() => "?").join(",");
  const [opportunities, organizations, campaigns, sweeps, taskCounts] =
    await db.batch([
      db
        .prepare(
          `SELECT j.id,j.board,j.title,j.company,j.location,j.source_url,
                  uj.status user_status
             FROM job_listings j
             LEFT JOIN user_listing_states uj ON uj.job_id=j.id AND uj.user_id=?
            WHERE j.inventory_status='active'
              AND lower(trim(j.country)) IN (${jobCountryPlaceholders})
            ORDER BY j.updated_at DESC,j.title`
        )
        .bind(userId, ...jobCountryNames),
      db
        .prepare(
          `SELECT o.id,o.name,o.city,o.website_url,o.market_segment,o.status,
                  o.outreach_eligibility,o.last_verified_at,
                  COUNT(cp.id) contact_count,
                  (SELECT COUNT(*) FROM organization_evidence evidence
                    WHERE evidence.organization_id=o.id) evidence_count,
                  (SELECT evidence.evidence_status FROM organization_evidence evidence
                    WHERE evidence.organization_id=o.id
                    ORDER BY evidence.observed_at DESC,evidence.id DESC LIMIT 1)
                    latest_evidence_status,
                  (SELECT evidence.roles FROM organization_evidence evidence
                    WHERE evidence.organization_id=o.id
                    ORDER BY evidence.observed_at DESC,evidence.id DESC LIMIT 1)
                    latest_roles
             FROM organizations o
             LEFT JOIN organization_contact_points cp
               ON cp.organization_id=o.id AND cp.status='active'
              AND cp.kind IN ('email','phone','contact_form')
            WHERE o.country_code=?
            GROUP BY o.id
            ORDER BY o.outreach_eligibility,o.name`
        )
        .bind(countryCode),
      db
        .prepare(
          `SELECT c.id,c.name,c.status,c.created_at,COUNT(t.id) target_count
             FROM campaigns c
             JOIN campaign_markets cm ON cm.campaign_id=c.id
             LEFT JOIN campaign_targets t ON t.campaign_id=c.id
            WHERE c.user_id=? AND cm.country_code=?
            GROUP BY c.id
            ORDER BY c.created_at DESC`
        )
        .bind(userId, countryCode),
      db
        .prepare(
          `SELECT id,status,requested_scope_json,requested_at,completed_at
             FROM country_sweeps
            WHERE country_code=? AND requested_by_user_id=?
            ORDER BY requested_at DESC`
        )
        .bind(countryCode, userId),
      db
        .prepare(
          `SELECT t.sweep_id,t.status,COUNT(*) count
             FROM country_sweep_tasks t
             JOIN country_sweeps s ON s.id=t.sweep_id
            WHERE s.country_code=? AND s.requested_by_user_id=?
            GROUP BY t.sweep_id,t.status`
        )
        .bind(countryCode, userId),
    ]);
  if (!(opportunities && organizations && campaigns && sweeps && taskCounts)) {
    throw new Error("Country detail could not be loaded");
  }

  const taskCountsBySweep = new Map<string, Record<string, number>>();
  for (const rawRow of taskCounts.results) {
    const row = D1_ROW_SCHEMA.parse(rawRow);
    const sweepId = String(row.sweep_id);
    const counts = taskCountsBySweep.get(sweepId) ?? {};
    counts[String(row.status)] = Number(row.count);
    taskCountsBySweep.set(sweepId, counts);
  }

  return {
    campaigns: campaigns.results.map((rawRow) => {
      const row = D1_ROW_SCHEMA.parse(rawRow);
      return {
        createdAt: String(row.created_at),
        id: String(row.id),
        name: String(row.name),
        status: String(row.status),
        targetCount: Number(row.target_count),
      };
    }),
    countryCode,
    countryName,
    opportunities: opportunities.results.map(
      (rawRow): CountryOpportunitySummary => {
        const row = D1_ROW_SCHEMA.parse(rawRow);
        return {
          board: String(row.board),
          company: String(row.company),
          id: String(row.id),
          location: String(row.location),
          sourceUrl: String(row.source_url),
          title: String(row.title),
          userStatus: nullableString(row.user_status),
        };
      }
    ),
    organizations: organizations.results.map(
      (rawRow): CountryOrganizationSummary => {
        const row = D1_ROW_SCHEMA.parse(rawRow);
        return {
          city: String(row.city),
          contactCount: Number(row.contact_count),
          evidenceCount: Number(row.evidence_count),
          id: String(row.id),
          lastVerifiedAt: nullableString(row.last_verified_at),
          latestEvidenceStatus: nullableString(row.latest_evidence_status),
          marketSegment: String(row.market_segment),
          name: String(row.name),
          outreachEligibility: String(row.outreach_eligibility),
          roleSummary: String(row.latest_roles ?? ""),
          status: String(row.status),
          websiteUrl: String(row.website_url),
        };
      }
    ),
    sweeps: sweeps.results.map((rawRow): CountrySweepSummary => {
      const row = D1_ROW_SCHEMA.parse(rawRow);
      const id = String(row.id);
      return {
        cities: requestedSweepCities(row.requested_scope_json),
        completedAt: nullableString(row.completed_at),
        id,
        requestedAt: String(row.requested_at),
        status: String(row.status),
        taskCounts: taskCountsBySweep.get(id) ?? {},
      };
    }),
  };
}

export async function createCountrySweep(
  db: D1Database,
  userId: string,
  countryCode: string,
  request: CountrySweepRequest
) {
  const countryName = countryNameForCode(countryCode);
  const normalizedRequest = normalizeSweepRequest(request);
  const requestedScopeJson = JSON.stringify(normalizedRequest);
  const active = await db
    .prepare(
      `SELECT id,status,requested_at,completed_at
         FROM country_sweeps
        WHERE country_code=? AND requested_by_user_id=? AND requested_scope_json=?
          AND status IN ('queued','claimed','running')
        ORDER BY requested_at DESC LIMIT 1`
    )
    .bind(countryCode, userId, requestedScopeJson)
    .first<SweepRow>();
  if (active) {
    return {
      completedAt: active.completed_at,
      id: active.id,
      requestedAt: active.requested_at,
      reused: true,
      status: active.status,
    };
  }

  const sweepId = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  const sources = [
    ["directories", normalizedRequest.includeDirectories],
    ["known_sources", normalizedRequest.includeKnownSources],
    ["maps", normalizedRequest.includeMaps],
    ["search", normalizedRequest.includeSearch],
  ] as const;
  const enabledSources = sources
    .filter(([, enabled]) => enabled)
    .map(([source]) => source);
  const discoveryScopes = enabledSources.flatMap((source) =>
    normalizedRequest.cities.length > 0
      ? normalizedRequest.cities.map((city) => ({ city, source }))
      : [{ city: "", source }]
  );
  const tasks = await Promise.all(
    discoveryScopes.map(async ({ city, source }) => {
      const inputJson = JSON.stringify({
        city,
        countryCode,
        countryName,
        phase: "discovery",
        source,
      });
      return {
        id: crypto.randomUUID(),
        inputHash: await countrySweepSha256(inputJson),
        inputJson,
        scopeKey: countrySweepScopeKey(source, city),
      };
    })
  );
  const taskRowsJson = JSON.stringify(tasks);
  if (
    new TextEncoder().encode(taskRowsJson).byteLength > MAX_D1_BOUND_VALUE_BYTES
  ) {
    throw new CountryMarketError(
      "Country sweep task manifest exceeds the D1 value limit",
      400
    );
  }
  await db.batch([
    db
      .prepare(
        `INSERT INTO country_sweeps
          (id,country_code,country_name,requested_by_user_id,status,
           requested_scope_json,task_total,requested_at,updated_at)
         VALUES (?,?,?,?,'queued',?,?,?,?)`
      )
      .bind(
        sweepId,
        countryCode,
        countryName,
        userId,
        requestedScopeJson,
        tasks.length,
        timestamp,
        timestamp
      ),
    db
      .prepare(
        `INSERT INTO country_sweep_tasks
          (id,sweep_id,phase,scope_key,status,input_json,input_hash,
           created_at,updated_at)
         SELECT
           json_extract(value,'$.id'),
           ?,
           'discovery',
           json_extract(value,'$.scopeKey'),
           'queued',
           json_extract(value,'$.inputJson'),
           json_extract(value,'$.inputHash'),
           ?,
           ?
         FROM json_each(?)`
      )
      .bind(sweepId, timestamp, timestamp, taskRowsJson),
  ]);
  return {
    completedAt: null,
    id: sweepId,
    requestedAt: timestamp,
    reused: false,
    status: "queued",
  };
}

function normalizeSweepRequest(request: CountrySweepRequest) {
  const cities = normalizeCountrySweepCities(request.cities);
  if (cities.length > MAX_COUNTRY_SWEEP_CITIES) {
    throw new CountryMarketError(
      `Choose at most ${MAX_COUNTRY_SWEEP_CITIES} distinct cities`,
      400
    );
  }
  return {
    ...request,
    cities,
  };
}
