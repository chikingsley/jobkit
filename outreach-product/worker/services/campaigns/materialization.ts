import type { AutomationPolicy } from "../../../src/features/automation/schema";
import type { CampaignStatus } from "../../../src/features/campaigns/schema";
import { countryNamesForCode } from "../country-markets";
import {
  CAMPAIGN_TARGET_PAGE_SIZE,
  CampaignError,
  type TargetSeedRow,
} from "./model";

export async function materializeCountryTargets(
  db: D1Database,
  campaignId: string,
  countryCode: string,
  policy: AutomationPolicy,
  timestamp: string
) {
  const countryNames = countryNamesForCode(countryCode);
  const placeholders = countryNames.map(() => "?").join(",");
  const allowedBoards = JSON.stringify(
    policy.allowedBoards.map((board) => board.toLowerCase())
  );
  const excludedSegments = JSON.stringify(policy.excludedMarketSegments);
  const freshnessThreshold = new Date(
    new Date(timestamp).getTime() - policy.routeFreshnessDays * 86_400_000
  ).toISOString();
  await db.batch([
    db
      .prepare(
        `INSERT OR IGNORE INTO campaign_targets
          (id,campaign_id,country_code,source_kind,subject_kind,subject_id,
           job_id,route_id,contact_channel_id,channel,route_strategy,dedup_key,
           status,hold_reason,match_label,admitted_at,updated_at)
         SELECT
           lower(hex(randomblob(16))),?,?,'advertised','job',j.id,j.id,ar.id,
           ar.contact_channel_id,
           CASE ar.kind
             WHEN 'email' THEN 'email'
             WHEN 'board_form' THEN 'board_form'
             WHEN 'external_url' THEN 'external_url'
             ELSE 'manual'
           END,
           CASE WHEN lower(j.board)='anesl' THEN 'anesl_bundle' ELSE 'single' END,
           CASE
             WHEN ar.contact_channel_id IS NOT NULL
               THEN 'contact:' || ar.contact_channel_id
             WHEN ar.kind='email' THEN 'email:' || lower(trim(ar.destination))
             WHEN ar.id IS NOT NULL THEN 'route:' || ar.id
             ELSE 'job:' || j.id
           END,
           CASE
             WHEN ar.id IS NULL OR ar.kind<>'email' THEN 'held'
             WHEN json_array_length(?)>0 AND lower(j.board) NOT IN (
               SELECT lower(value) FROM json_each(?)
             ) THEN 'held'
             WHEN EXISTS (
               SELECT 1 FROM json_each(j.market_segments_json) segment
                WHERE segment.value IN (SELECT value FROM json_each(?))
             ) THEN 'held'
             WHEN ?=1 AND j.compensation_amount_min IS NULL
               AND j.compensation_amount_max IS NULL THEN 'held'
             WHEN COALESCE(ar.last_verified_at,'')<? THEN 'held'
             ELSE 'eligible'
           END,
           CASE
             WHEN ar.id IS NULL THEN 'No active application route'
             WHEN ar.kind<>'email' THEN 'Manual application route; open it from job_listings'
             WHEN json_array_length(?)>0 AND lower(j.board) NOT IN (
               SELECT lower(value) FROM json_each(?)
             ) THEN 'Board is outside the saved automation policy'
             WHEN EXISTS (
               SELECT 1 FROM json_each(j.market_segments_json) segment
                WHERE segment.value IN (SELECT value FROM json_each(?))
             ) THEN 'Excluded market segment in the saved automation policy'
             WHEN ?=1 AND j.compensation_amount_min IS NULL
               AND j.compensation_amount_max IS NULL
               THEN 'Compensation is required by the saved automation policy'
             WHEN COALESCE(ar.last_verified_at,'')<?
               THEN 'Application route needs verification'
             ELSE ''
           END,
           CASE
             WHEN ar.id IS NULL OR ar.kind<>'email' THEN 'Manual review'
             ELSE ''
           END,
           ?,?
         FROM job_listings j
         LEFT JOIN application_routes ar ON ar.id=(
           SELECT candidate.id FROM application_routes candidate
            WHERE candidate.job_id=j.id AND candidate.status='active'
            ORDER BY CASE candidate.kind
              WHEN 'email' THEN 0 WHEN 'board_form' THEN 1
              WHEN 'external_url' THEN 2 ELSE 3 END,
              candidate.last_verified_at DESC,candidate.updated_at DESC
            LIMIT 1
         )
         WHERE j.inventory_status='active'
           AND lower(trim(j.country)) IN (${placeholders})`
      )
      .bind(
        campaignId,
        countryCode,
        allowedBoards,
        allowedBoards,
        excludedSegments,
        Number(policy.requireKnownCompensation),
        freshnessThreshold,
        allowedBoards,
        allowedBoards,
        excludedSegments,
        Number(policy.requireKnownCompensation),
        freshnessThreshold,
        timestamp,
        timestamp,
        ...countryNames
      ),
    db
      .prepare(
        `INSERT OR IGNORE INTO campaign_targets
          (id,campaign_id,country_code,source_kind,subject_kind,subject_id,
           organization_id,contact_point_id,channel,route_strategy,dedup_key,
           status,hold_reason,match_label,admitted_at,updated_at)
         SELECT
           lower(hex(randomblob(16))),?,?,'school','organization',o.id,o.id,
           cp.id,'email','single','email:' || lower(trim(cp.value)),
           CASE
             WHEN o.market_segment IN (SELECT value FROM json_each(?))
               THEN 'held'
             ELSE 'eligible'
           END,
           CASE
             WHEN o.market_segment IN (SELECT value FROM json_each(?))
               THEN 'Excluded market segment in the saved automation policy'
             ELSE ''
           END,
           CASE
             WHEN o.market_segment IN (SELECT value FROM json_each(?))
               THEN 'Excluded market segment'
             ELSE 'Eligible outreach'
           END,
           ?,?
         FROM organizations o
         JOIN organization_contact_points cp ON cp.id=(
           SELECT candidate.id FROM organization_contact_points candidate
            WHERE candidate.organization_id=o.id
              AND candidate.kind='email' AND candidate.status='active'
            ORDER BY candidate.last_verified_at DESC,candidate.updated_at DESC
            LIMIT 1
         )
         WHERE o.country_code=? AND o.status='active'
           AND o.outreach_eligibility='eligible'`
      )
      .bind(
        campaignId,
        countryCode,
        JSON.stringify(policy.excludedMarketSegments),
        JSON.stringify(policy.excludedMarketSegments),
        JSON.stringify(policy.excludedMarketSegments),
        timestamp,
        timestamp,
        countryCode
      ),
  ]);
}

export interface CalibrationGroup {
  channel: string;
  dedupKey: string;
  routeStrategy: "anesl_bundle" | "single";
  targets: TargetSeedRow[];
}

interface CalibrationCandidate extends CalibrationGroup {
  countryCode: string;
  sourceKind: string;
}

function selectRoundRobinCandidates(
  candidates: CalibrationCandidate[],
  count: number
) {
  const selected: CalibrationCandidate[] = [];
  const dimensions = [
    ...new Set(
      candidates.map(
        (candidate) => `${candidate.countryCode}:${candidate.sourceKind}`
      )
    ),
  ];
  while (selected.length < count) {
    let changed = false;
    for (const dimension of dimensions) {
      const candidate = candidates.find(
        (item) =>
          `${item.countryCode}:${item.sourceKind}` === dimension &&
          !selected.includes(item)
      );
      if (candidate) {
        selected.push(candidate);
        changed = true;
      }
      if (selected.length >= count) {
        break;
      }
    }
    if (!changed) {
      break;
    }
  }
  return selected;
}

export function selectCalibrationGroups(
  seeds: TargetSeedRow[],
  count: number
): CalibrationGroup[] {
  const grouped = new Map<string, TargetSeedRow[]>();
  for (const seed of seeds) {
    const group = grouped.get(seed.dedup_key) ?? [];
    if (seed.route_strategy === "anesl_bundle" && group.length >= 5) {
      continue;
    }
    group.push(seed);
    grouped.set(seed.dedup_key, group);
  }
  const candidates: CalibrationCandidate[] = [...grouped.values()].map(
    (targets) => ({
      channel: targets[0]?.channel ?? "manual",
      countryCode: targets[0]?.country_code ?? "",
      dedupKey: targets[0]?.dedup_key ?? "",
      routeStrategy: targets[0]?.route_strategy ?? "single",
      sourceKind: targets[0]?.source_kind ?? "advertised",
      targets:
        targets[0]?.route_strategy === "anesl_bundle"
          ? targets
          : targets.slice(0, 1),
    })
  );
  return selectRoundRobinCandidates(candidates, count);
}

export function campaignTransition(
  current: CampaignStatus,
  action: "cancel" | "pause" | "resume" | "start"
): CampaignStatus {
  if (action === "cancel" && !["completed", "canceled"].includes(current)) {
    return "canceled";
  }
  if (action === "pause" && current === "running") {
    return "paused";
  }
  if (action === "resume" && current === "paused") {
    return "running";
  }
  if (action === "start" && current === "ready") {
    return "running";
  }
  throw new CampaignError(`A ${current} campaign cannot ${action}`, 409);
}

export function campaignTargetPageSize() {
  return CAMPAIGN_TARGET_PAGE_SIZE;
}
