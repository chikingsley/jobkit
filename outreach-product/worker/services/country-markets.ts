import { getCountries } from "libphonenumber-js";
import type { AutomationPolicy } from "../../src/features/automation/schema";
import type {
  CountryCampaignLaunch,
  CountrySweepRequest,
} from "../../src/features/countries/schema";
import type {
  CountryCampaignSummary,
  CountryDetail,
  CountryMarketSummary,
  CountryOpportunitySummary,
  CountryOrganizationSummary,
  CountrySweepSummary,
} from "../../src/features/countries/types";
import { readAutomationPolicy } from "../repositories/automation-policy";

interface CountryCountRow {
  count: number;
  country_code?: string;
  country_name: string;
  latest_at?: string | null;
  latest_status?: string | null;
}

interface CampaignRow {
  created_at: string;
  execution_mode: CountryCampaignSummary["executionMode"];
  id: string;
  include_open_positions: number;
  include_school_outreach: number;
  status: string;
  sweep_status: string | null;
  target_count: number;
}

interface SweepRow {
  completed_at: string | null;
  id: string;
  requested_at: string;
  status: string;
}

interface SweepTaskCountRow {
  count: number;
  status: string;
  sweep_id: string;
}

interface JobTargetRow {
  board: string;
  compensation_confidence: string;
  job_id: string;
  market_segments_json: string;
  route_id: string | null;
  route_kind: string | null;
  route_last_verified_at: string | null;
}

interface OrganizationTargetRow {
  contact_point_id: string | null;
  organization_id: string;
}

interface OpportunityRow {
  board: string;
  company: string;
  id: string;
  location: string;
  source_url: string;
  title: string;
  user_status: string | null;
}

interface CountryOrganizationRow {
  city: string;
  contact_count: number;
  id: string;
  last_verified_at: string | null;
  market_segment: string;
  name: string;
  outreach_eligibility: string;
  status: string;
  website_url: string;
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

export class CountryMarketError extends Error {
  readonly status: 400 | 404 | 409;

  constructor(message: string, status: 400 | 404 | 409) {
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

function countryNamesForCode(countryCode: string) {
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
           FROM jobs WHERE trim(country)<>''
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
          GROUP BY o.country_code,o.country_name`
      ),
      db
        .prepare(
          `SELECT country_code,country_name,COUNT(*) count
           FROM country_campaigns
          WHERE user_id=?
          GROUP BY country_code,country_name`
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
      read(code, row.country_name).openPositionCount = Number(row.count);
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
             FROM jobs j
             LEFT JOIN user_jobs uj ON uj.job_id=j.id AND uj.user_id=?
            WHERE lower(trim(j.country)) IN (${jobCountryPlaceholders})
            ORDER BY j.updated_at DESC,j.title
            LIMIT 200`
        )
        .bind(userId, ...jobCountryNames),
      db
        .prepare(
          `SELECT o.id,o.name,o.city,o.website_url,o.market_segment,o.status,
                  o.outreach_eligibility,o.last_verified_at,
                  COUNT(cp.id) contact_count
             FROM organizations o
             LEFT JOIN organization_contact_points cp
               ON cp.organization_id=o.id AND cp.status='active'
            WHERE o.country_code=?
            GROUP BY o.id
            ORDER BY o.outreach_eligibility,o.name
            LIMIT 500`
        )
        .bind(countryCode),
      db
        .prepare(
          `SELECT c.id,c.execution_mode,c.include_open_positions,
                  c.include_school_outreach,c.status,c.created_at,
                  s.status sweep_status,COUNT(t.id) target_count
             FROM country_campaigns c
             LEFT JOIN country_sweeps s ON s.id=c.sweep_id
             LEFT JOIN country_campaign_targets t ON t.campaign_id=c.id
            WHERE c.user_id=? AND c.country_code=?
            GROUP BY c.id
            ORDER BY c.created_at DESC
            LIMIT 30`
        )
        .bind(userId, countryCode),
      db
        .prepare(
          `SELECT id,status,requested_at,completed_at
             FROM country_sweeps
            WHERE country_code=?
            ORDER BY requested_at DESC
            LIMIT 20`
        )
        .bind(countryCode),
      db
        .prepare(
          `SELECT t.sweep_id,t.status,COUNT(*) count
             FROM country_sweep_tasks t
             JOIN country_sweeps s ON s.id=t.sweep_id
            WHERE s.country_code=?
            GROUP BY t.sweep_id,t.status`
        )
        .bind(countryCode),
    ]);
  if (!(opportunities && organizations && campaigns && sweeps && taskCounts)) {
    throw new Error("Country detail could not be loaded");
  }

  const taskCountsBySweep = new Map<string, Record<string, number>>();
  for (const rawRow of taskCounts.results) {
    const row = rawRow as unknown as SweepTaskCountRow;
    const counts = taskCountsBySweep.get(row.sweep_id) ?? {};
    counts[row.status] = Number(row.count);
    taskCountsBySweep.set(row.sweep_id, counts);
  }

  return {
    campaigns: campaigns.results.map((rawRow) => {
      const row = rawRow as unknown as CampaignRow;
      return {
        createdAt: row.created_at,
        executionMode: row.execution_mode,
        id: row.id,
        includeOpenPositions: Boolean(row.include_open_positions),
        includeSchoolOutreach: Boolean(row.include_school_outreach),
        status: row.status,
        sweepStatus: row.sweep_status,
        targetCount: Number(row.target_count),
      };
    }),
    countryCode,
    countryName,
    opportunities: opportunities.results.map(
      (rawRow): CountryOpportunitySummary => {
        const row = rawRow as OpportunityRow;
        return {
          board: String(row.board),
          company: String(row.company),
          id: String(row.id),
          location: String(row.location),
          sourceUrl: String(row.source_url),
          title: String(row.title),
          userStatus: row.user_status ? String(row.user_status) : null,
        };
      }
    ),
    organizations: organizations.results.map(
      (rawRow): CountryOrganizationSummary => {
        const row = rawRow as CountryOrganizationRow;
        return {
          city: String(row.city),
          contactCount: Number(row.contact_count),
          id: String(row.id),
          lastVerifiedAt: row.last_verified_at
            ? String(row.last_verified_at)
            : null,
          marketSegment: String(row.market_segment),
          name: String(row.name),
          outreachEligibility: String(row.outreach_eligibility),
          status: String(row.status),
          websiteUrl: String(row.website_url),
        };
      }
    ),
    sweeps: sweeps.results.map((rawRow): CountrySweepSummary => {
      const row = rawRow as unknown as SweepRow;
      return {
        completedAt: row.completed_at,
        id: row.id,
        requestedAt: row.requested_at,
        status: row.status,
        taskCounts: taskCountsBySweep.get(row.id) ?? {},
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
  const active = await db
    .prepare(
      `SELECT id,status,requested_at,completed_at
         FROM country_sweeps
        WHERE country_code=? AND status IN ('queued','claimed','running')
        ORDER BY requested_at DESC LIMIT 1`
    )
    .bind(countryCode)
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
    ["directories", request.includeDirectories],
    ["known_sources", request.includeKnownSources],
    ["maps", request.includeMaps],
    ["search", request.includeSearch],
  ] as const;
  const enabledSources = sources
    .filter(([, enabled]) => enabled)
    .map(([source]) => source);
  await db.batch([
    db
      .prepare(
        `INSERT INTO country_sweeps
          (id,country_code,country_name,requested_by_user_id,status,
           requested_scope_json,requested_at,updated_at)
         VALUES (?,?,?,?,'queued',?,?,?)`
      )
      .bind(
        sweepId,
        countryCode,
        countryName,
        userId,
        JSON.stringify(request),
        timestamp,
        timestamp
      ),
    ...enabledSources.map((source) =>
      db
        .prepare(
          `INSERT INTO country_sweep_tasks
            (id,sweep_id,phase,scope_key,status,input_json,created_at,updated_at)
           VALUES (?,?,'discovery',?,'queued',?,?,?)`
        )
        .bind(
          crypto.randomUUID(),
          sweepId,
          source,
          JSON.stringify({
            countryCode,
            countryName,
            phase: "discovery",
            source,
          }),
          timestamp,
          timestamp
        )
    ),
  ]);
  return {
    completedAt: null,
    id: sweepId,
    requestedAt: timestamp,
    reused: false,
    status: "queued",
  };
}

export async function launchCountryCampaign(
  db: D1Database,
  userId: string,
  countryCode: string,
  launch: CountryCampaignLaunch
) {
  const countryName = countryNameForCode(countryCode);
  const policy = (await readAutomationPolicy(db, userId)).value;
  if (launch.executionMode === "use_automation" && policy.paused) {
    throw new CountryMarketError(
      "Automation is paused. Resume it or choose review every message.",
      409
    );
  }
  const sweep = launch.includeSchoolOutreach
    ? await createCountrySweep(db, userId, countryCode, {
        includeDirectories: true,
        includeKnownSources: true,
        includeMaps: true,
        includeSearch: true,
      })
    : null;
  const campaignId = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO country_campaigns
        (id,user_id,country_code,country_name,sweep_id,execution_mode,
         include_open_positions,include_school_outreach,policy_snapshot_json,
         status,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,'planned',?,?)`
    )
    .bind(
      campaignId,
      userId,
      countryCode,
      countryName,
      sweep?.id ?? null,
      launch.executionMode,
      Number(launch.includeOpenPositions),
      Number(launch.includeSchoolOutreach),
      JSON.stringify(policy),
      timestamp,
      timestamp
    )
    .run();

  await insertCampaignTargets(
    db,
    campaignId,
    countryCode,
    launch,
    policy,
    timestamp
  );

  const targetCount = await db
    .prepare(
      "SELECT COUNT(*) count FROM country_campaign_targets WHERE campaign_id=?"
    )
    .bind(campaignId)
    .first<number>("count");
  return {
    campaignId,
    executionMode: launch.executionMode,
    status: "planned",
    sweep,
    targetCount: Number(targetCount ?? 0),
  };
}

async function insertCampaignTargets(
  db: D1Database,
  campaignId: string,
  countryCode: string,
  launch: CountryCampaignLaunch,
  policy: AutomationPolicy,
  timestamp: string
) {
  if (launch.executionMode === "research_only") {
    return;
  }
  const statements: D1PreparedStatement[] = [];
  if (launch.includeOpenPositions) {
    const targets = await readJobTargets(db, countryCode);
    for (const target of targets) {
      const decision = targetDecision(
        launch.executionMode,
        target.route_kind,
        target,
        policy
      );
      statements.push(
        db
          .prepare(
            `INSERT INTO country_campaign_targets
              (id,campaign_id,job_id,route_id,channel,status,hold_reason,
               created_at,updated_at)
             VALUES (?,?,?,?,?,?,?,?,?)`
          )
          .bind(
            crypto.randomUUID(),
            campaignId,
            target.job_id,
            target.route_id,
            channelForRoute(target.route_kind),
            decision.status,
            decision.reason,
            timestamp,
            timestamp
          )
      );
    }
  }
  if (launch.includeSchoolOutreach) {
    const targets = await readOrganizationTargets(db, countryCode);
    for (const target of targets) {
      const decision =
        launch.executionMode === "review_each"
          ? { reason: "", status: "review" }
          : automationDecision("email", policy);
      statements.push(
        db
          .prepare(
            `INSERT INTO country_campaign_targets
              (id,campaign_id,organization_id,contact_point_id,channel,status,
               hold_reason,created_at,updated_at)
             VALUES (?,?,?,?,'email',?,?,?,?)`
          )
          .bind(
            crypto.randomUUID(),
            campaignId,
            target.organization_id,
            target.contact_point_id,
            decision.status,
            decision.reason,
            timestamp,
            timestamp
          )
      );
    }
  }
  if (statements.length > 0) {
    await db.batch(statements);
  }
}

async function readJobTargets(db: D1Database, countryCode: string) {
  const countryNames = countryNamesForCode(countryCode);
  const placeholders = countryNames.map(() => "?").join(",");
  const result = await db
    .prepare(
      `SELECT j.id job_id,j.board,j.market_segments_json,
              j.compensation_confidence,ar.id route_id,ar.kind route_kind,
              ar.last_verified_at route_last_verified_at
         FROM jobs j
         LEFT JOIN application_routes ar ON ar.id=(
           SELECT candidate.id FROM application_routes candidate
            WHERE candidate.job_id=j.id AND candidate.status='active'
            ORDER BY CASE candidate.kind
              WHEN 'email' THEN 0 WHEN 'board_form' THEN 1
              WHEN 'external_url' THEN 2 ELSE 3 END,
              candidate.last_verified_at DESC
            LIMIT 1
        )
        WHERE lower(trim(j.country)) IN (${placeholders})
        ORDER BY j.updated_at DESC
        LIMIT 500`
    )
    .bind(...countryNames)
    .all<JobTargetRow>();
  return result.results;
}

async function readOrganizationTargets(db: D1Database, countryCode: string) {
  const result = await db
    .prepare(
      `SELECT o.id organization_id,cp.id contact_point_id
         FROM organizations o
         JOIN organization_contact_points cp ON cp.id=(
           SELECT candidate.id FROM organization_contact_points candidate
            WHERE candidate.organization_id=o.id
              AND candidate.kind='email' AND candidate.status='active'
            ORDER BY candidate.last_verified_at DESC,candidate.updated_at DESC
            LIMIT 1
         )
        WHERE o.country_code=? AND o.status='active'
          AND o.outreach_eligibility='eligible'
        ORDER BY o.name
        LIMIT 500`
    )
    .bind(countryCode)
    .all<OrganizationTargetRow>();
  return result.results;
}

function targetDecision(
  executionMode: CountryCampaignLaunch["executionMode"],
  routeKind: string | null,
  target: JobTargetRow,
  policy: AutomationPolicy
) {
  if (executionMode === "review_each") {
    return { reason: "", status: "review" };
  }
  const channel = channelForRoute(routeKind);
  const channelDecision = automationDecision(channel, policy);
  if (channelDecision.status !== "review") {
    return channelDecision;
  }
  if (
    policy.allowedBoards.length > 0 &&
    !policy.allowedBoards.includes(target.board)
  ) {
    return {
      reason: "Source is outside the saved automation policy",
      status: "held",
    };
  }
  const segments = JSON.parse(target.market_segments_json) as string[];
  const excludedSegments = new Set<string>(policy.excludedMarketSegments);
  if (segments.some((segment) => excludedSegments.has(segment))) {
    return {
      reason: "Organization type is excluded from automation",
      status: "held",
    };
  }
  if (
    policy.requireKnownCompensation &&
    target.compensation_confidence === "unknown"
  ) {
    return {
      reason: "Compensation must be known before automatic execution",
      status: "held",
    };
  }
  if (!routeIsFresh(target.route_last_verified_at, policy.routeFreshnessDays)) {
    return {
      reason: "Application route needs fresh verification",
      status: "held",
    };
  }
  return {
    reason: "Fit threshold must be evaluated before automatic execution",
    status: "review",
  };
}

function automationDecision(
  channel: ReturnType<typeof channelForRoute>,
  policy: AutomationPolicy
) {
  if (channel === "manual" || channel === "external_url") {
    return { reason: "This route requires manual review", status: "held" };
  }
  const mode = channel === "email" ? policy.email.mode : policy.boardForm.mode;
  if (mode === "off") {
    return { reason: "This channel is disabled", status: "held" };
  }
  if (mode === "review") {
    return { reason: "", status: "review" };
  }
  return {
    reason: "Fit threshold must be evaluated before automatic execution",
    status: "review",
  };
}

function channelForRoute(routeKind: string | null) {
  if (routeKind === "email") {
    return "email" as const;
  }
  if (routeKind === "board_form") {
    return "board_form" as const;
  }
  if (routeKind === "external_url") {
    return "external_url" as const;
  }
  return "manual" as const;
}

function routeIsFresh(lastVerifiedAt: string | null, freshnessDays: number) {
  if (!lastVerifiedAt) {
    return false;
  }
  const verifiedAt = Date.parse(lastVerifiedAt);
  return (
    Number.isFinite(verifiedAt) &&
    Date.now() - verifiedAt <= freshnessDays * 24 * 60 * 60 * 1000
  );
}
