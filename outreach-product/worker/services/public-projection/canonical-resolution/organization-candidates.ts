import { canonicalJson, canonicalSha256, compareUtf8Bytes } from "../hash";
import type { ClaimedProjectionPosition } from "../position-items";
import {
  type LocationResolutionArtifact,
  MAX_ORGANIZATION_CANDIDATES,
  type OrganizationCandidateArtifact,
  type OrganizationDomainMappingRow,
  type OrganizationEvidenceRow,
  type OrganizationResolutionArtifact,
  type OrganizationResolutionCandidate,
  type OrganizationRouteIdentity,
  type OrganizationRow,
  PUBLIC_SUFFIX_LIST_VERSION,
  type ResolutionInputs,
} from "./model";
import { blockedOrganizationResolution } from "./organization-evidence";
import {
  organizationDomainMappingMatches,
  organizationEvidenceArtifacts,
  organizationEvidenceTier,
  organizationResolutionOutcome,
} from "./organization-outcome";
import {
  countryCodeForLabel,
  normalizeDomain,
  normalizedHost,
  normalizeText,
  organizationRouteIdentities,
  sha256Id,
} from "./support";

export async function resolveOrganization(
  db: D1Database,
  claim: ClaimedProjectionPosition,
  inputs: ResolutionInputs,
  locations: LocationResolutionArtifact[],
  timestamp: string
): Promise<OrganizationResolutionArtifact> {
  const resolutionId = await sha256Id(
    "organization-resolution-v1_",
    `jobkit-projection-organization-resolution/v1\0${claim.runId}\0${claim.id}\0${claim.inputHash}`
  );
  const normalizedCompanyName = normalizeText(inputs.listing.material.company);
  const assertedCountryCode = countryCodeForLabel(
    inputs.listing.material.country
  );
  const resolvedLocalities = locations
    .filter((location) => location.state === "resolved")
    .map((location) => normalizeText(location.locality))
    .filter(Boolean)
    .sort(compareUtf8Bytes);
  const resolvedLocality = resolvedLocalities[0] ?? "";
  const routeIdentities = organizationRouteIdentities([
    inputs.listing.material.applyUrl,
    inputs.listing.material.sourceUrl,
  ]);
  const hosts = routeIdentities.map((route) => route.host);
  const registrableDomains = [
    ...new Set(
      routeIdentities.map((route) => route.registrableDomain).filter(Boolean)
    ),
  ].sort(compareUtf8Bytes);
  const rows = await db
    .prepare(
      `SELECT organization.id,organization.name,organization.country_code,
              organization.country_name,organization.city,
              organization.region,organization.canonical_domain,
              organization.status,
              EXISTS (
                SELECT 1 FROM organization_opportunities opportunity
                 WHERE opportunity.organization_id=organization.id
                   AND opportunity.job_id=?
              ) opportunity_link,
              EXISTS (
                SELECT 1
                  FROM organization_opportunities opportunity
                  JOIN organization_opportunity_acceptances acceptance
                    ON acceptance.organization_id=opportunity.organization_id
                   AND acceptance.job_id=opportunity.job_id
                 WHERE opportunity.organization_id=organization.id
                   AND opportunity.job_id=?
              ) accepted_opportunity_link,
              EXISTS (
                SELECT 1 FROM organization_source_employer_mappings mapping
                 WHERE mapping.organization_id=organization.id
                   AND mapping.source_key=? AND mapping.employer_id=?
                   AND ?<>''
              ) source_employer_link
         FROM organizations organization
        WHERE EXISTS (
                SELECT 1 FROM organization_opportunities opportunity
                 WHERE opportunity.organization_id=organization.id
                   AND opportunity.job_id=?
              )
           OR EXISTS (
                SELECT 1 FROM organization_source_employer_mappings mapping
                 WHERE mapping.organization_id=organization.id
                   AND mapping.source_key=? AND mapping.employer_id=?
                   AND ?<>''
              )
           OR (
              (? IS NULL OR organization.country_code=?)
              AND EXISTS (
                SELECT 1 FROM organization_domain_mappings mapping
                 WHERE mapping.organization_id=organization.id
                   AND mapping.public_suffix_list_version=?
                   AND (
                     (mapping.mapping_kind IN (
                        'employer_host','hosted_ats_tenant'
                      ) AND mapping.normalized_host IN (
                        SELECT CAST(value AS TEXT) FROM json_each(?)
                      ))
                     OR (
                       mapping.mapping_kind='employer_registrable_domain'
                       AND mapping.registrable_domain IN (
                         SELECT CAST(value AS TEXT) FROM json_each(?)
                       )
                     )
                   )
              ))
           OR (
             (? IS NULL OR organization.country_code=?)
             AND (
               lower(organization.name)=lower(?)
               OR lower(organization.canonical_domain)=lower(?)
               OR lower(organization.canonical_domain)=lower(?)
             )
           )
        ORDER BY organization.id LIMIT ?`
    )
    .bind(
      inputs.listing.listingId,
      inputs.listing.listingId,
      inputs.listing.board,
      inputs.listing.material.employerId,
      inputs.listing.material.employerId,
      inputs.listing.listingId,
      inputs.listing.board,
      inputs.listing.material.employerId,
      inputs.listing.material.employerId,
      assertedCountryCode,
      assertedCountryCode,
      PUBLIC_SUFFIX_LIST_VERSION,
      canonicalJson(hosts),
      canonicalJson(registrableDomains),
      assertedCountryCode,
      assertedCountryCode,
      inputs.listing.material.company.trim(),
      hosts[0] ?? "",
      hosts[1] ?? "",
      MAX_ORGANIZATION_CANDIDATES + 1
    )
    .all<OrganizationRow>();
  if (rows.results.length > MAX_ORGANIZATION_CANDIDATES) {
    return blockedOrganizationResolution(
      resolutionId,
      normalizedCompanyName,
      assertedCountryCode,
      resolvedLocality
    );
  }
  const organizationIds = rows.results.map((row) => row.id);
  const evidenceRows =
    organizationIds.length === 0
      ? []
      : (
          await db
            .prepare(
              `SELECT id,organization_id,evidence_status,source_url,observed_at
                 FROM organization_evidence
                WHERE organization_id IN (
                  SELECT CAST(value AS TEXT) FROM json_each(?)
                )
                ORDER BY organization_id,observed_at,id LIMIT 500`
            )
            .bind(canonicalJson(organizationIds))
            .all<OrganizationEvidenceRow>()
        ).results;
  const evidenceByOrganization = groupOrganizationEvidence(evidenceRows);
  const domainMappingRows =
    organizationIds.length === 0
      ? []
      : (
          await db
            .prepare(
              `SELECT id,organization_id,mapping_kind,normalized_host,
                      registrable_domain,path_prefix,
                      public_suffix_list_version,accepted_at,evidence_url
                 FROM organization_domain_mappings
                WHERE organization_id IN (
                  SELECT CAST(value AS TEXT) FROM json_each(?)
                )
                  AND public_suffix_list_version=?
                ORDER BY organization_id,mapping_kind,normalized_host,
                         path_prefix,id LIMIT 500`
            )
            .bind(canonicalJson(organizationIds), PUBLIC_SUFFIX_LIST_VERSION)
            .all<OrganizationDomainMappingRow>()
        ).results;
  const domainMappingsByOrganization =
    groupOrganizationDomainMappings(domainMappingRows);
  const preliminary = rows.results.map((row) =>
    organizationResolutionCandidate({
      assertedCountryCode,
      domainMappingsByOrganization,
      evidenceByOrganization,
      hosts,
      normalizedCompanyName,
      resolvedLocality,
      routeIdentities,
      row,
    })
  );
  const activePositive = preliminary.filter(
    (candidate) => candidate.row.status === "active" && candidate.tier <= 3
  );
  const tierOneIds = new Set(
    activePositive
      .filter((candidate) => candidate.tier === 1)
      .map((candidate) => candidate.row.id)
  );
  const tierTwoIds = new Set(
    preliminary
      .filter(
        (candidate) =>
          candidate.row.status === "active" &&
          (assertedCountryCode === null ||
            candidate.row.country_code === assertedCountryCode) &&
          candidate.verifiedDomainMappings.length > 0
      )
      .map((candidate) => candidate.row.id)
  );
  const tierConflict =
    tierOneIds.size > 0 &&
    [...tierTwoIds].some((organizationId) => !tierOneIds.has(organizationId));
  const highestTier = Math.min(
    ...activePositive.map((candidate) => candidate.tier),
    Number.POSITIVE_INFINITY
  );
  const highest = activePositive.filter(
    (candidate) => candidate.tier === highestTier
  );
  const selected = !tierConflict && highest.length === 1 ? highest[0] : null;
  const { reasonCode, state } = organizationResolutionOutcome(
    preliminary,
    selected ?? null,
    tierConflict || highest.length > 1
  );
  const candidates = await Promise.all(
    preliminary
      .sort(
        (left, right) =>
          left.tier - right.tier || compareUtf8Bytes(left.row.id, right.row.id)
      )
      .map(async (candidate, ordinal) => {
        const candidateWithoutHash = {
          countryCode: candidate.row.country_code,
          evidenceTier: candidate.tier,
          normalizedDomain: normalizeDomain(candidate.row.canonical_domain),
          normalizedLocality: normalizeText(candidate.row.city),
          normalizedName: normalizeText(candidate.row.name),
          organizationId: candidate.row.id,
          organizationStatus: candidate.row.status,
          selected: selected?.row.id === candidate.row.id ? 1 : 0,
        };
        return {
          ...candidateWithoutHash,
          candidateHash: await canonicalSha256(candidateWithoutHash),
          createdAt: timestamp,
          ordinal,
          resolutionId,
          runId: claim.runId,
        } satisfies OrganizationCandidateArtifact;
      })
  );
  const evidence = await organizationEvidenceArtifacts(
    claim,
    resolutionId,
    preliminary,
    inputs.listing.material.employerId,
    timestamp
  );
  const candidateDigest = await canonicalSha256(
    candidates.map(({ createdAt: _createdAt, ...candidate }) => candidate)
  );
  const evidenceDigest = await canonicalSha256(
    evidence.map(({ createdAt: _createdAt, ...item }) => item)
  );
  const withoutHash = {
    assertedCountryCode,
    candidateCount: candidates.length,
    candidateDigest,
    evidenceCount: evidence.length,
    evidenceDigest,
    normalizedCompanyName,
    reasonCode,
    resolvedLocality,
    selectedDisplayName: selected?.row.name ?? "",
    selectedOrganizationId: selected?.row.id ?? null,
    state,
  };
  return {
    ...withoutHash,
    candidates,
    evidence,
    resolutionHash: await canonicalSha256(withoutHash),
    resolutionId,
  };
}

function groupOrganizationEvidence(rows: OrganizationEvidenceRow[]) {
  const grouped = new Map<string, OrganizationEvidenceRow[]>();
  for (const row of rows) {
    const group = grouped.get(row.organization_id) ?? [];
    group.push(row);
    grouped.set(row.organization_id, group);
  }
  return grouped;
}

function groupOrganizationDomainMappings(rows: OrganizationDomainMappingRow[]) {
  const grouped = new Map<string, OrganizationDomainMappingRow[]>();
  for (const row of rows) {
    const group = grouped.get(row.organization_id) ?? [];
    group.push(row);
    grouped.set(row.organization_id, group);
  }
  return grouped;
}

function organizationResolutionCandidate(input: {
  assertedCountryCode: string | null;
  domainMappingsByOrganization: Map<string, OrganizationDomainMappingRow[]>;
  evidenceByOrganization: Map<string, OrganizationEvidenceRow[]>;
  hosts: string[];
  normalizedCompanyName: string;
  resolvedLocality: string;
  routeIdentities: OrganizationRouteIdentity[];
  row: OrganizationRow;
}): OrganizationResolutionCandidate {
  const { row } = input;
  const rowEvidence = input.evidenceByOrganization.get(row.id) ?? [];
  const evidenceActive = rowEvidence.some((item) =>
    ["active", "outreach"].includes(item.evidence_status)
  );
  const normalizedDomain = normalizeDomain(row.canonical_domain);
  const exactDomain =
    Boolean(normalizedDomain) &&
    input.hosts.includes(normalizedDomain) &&
    rowEvidence.some(
      (item) =>
        ["active", "outreach"].includes(item.evidence_status) &&
        normalizedHost(item.source_url) === normalizedDomain
    );
  const exactName = normalizeText(row.name) === input.normalizedCompanyName;
  const exactCountry =
    input.assertedCountryCode !== null &&
    row.country_code === input.assertedCountryCode;
  const exactLocality =
    Boolean(input.resolvedLocality) &&
    normalizeText(row.city) === input.resolvedLocality;
  const verifiedDomainMappings = (
    input.domainMappingsByOrganization.get(row.id) ?? []
  ).filter((mapping) =>
    organizationDomainMappingMatches(mapping, row, input.routeIdentities)
  );
  return {
    acceptedOpportunityLink: row.accepted_opportunity_link === 1,
    exactCountry,
    exactDomain,
    exactLocality,
    exactName,
    row,
    rowEvidence,
    sourceEmployerLink: row.source_employer_link === 1,
    tier: organizationEvidenceTier({
      acceptedOpportunityLink: row.accepted_opportunity_link === 1,
      evidenceActive,
      exactCountry,
      exactDomain,
      exactLocality,
      exactName,
      sourceEmployerLink: row.source_employer_link === 1,
      verifiedDomainMapping: verifiedDomainMappings.length > 0,
    }),
    verifiedDomainMappings,
  };
}
