import { canonicalSha256 } from "../hash";
import type { ClaimedProjectionPosition } from "../position-items";
import type {
  OrganizationEvidenceArtifact,
  OrganizationResolutionArtifact,
  OrganizationResolutionCandidate,
} from "./model";
import { normalizeDomain } from "./support";

type OrganizationEvidenceSeed = Omit<
  OrganizationEvidenceArtifact,
  "createdAt" | "evidenceHash" | "ordinal"
>;

function nameCountryEvidence(
  claim: ClaimedProjectionPosition,
  resolutionId: string,
  candidate: OrganizationResolutionCandidate,
  timestamp: string
): OrganizationEvidenceSeed {
  const exactLocation =
    candidate.exactName && candidate.exactCountry && candidate.exactLocality;
  return {
    evidenceKind: exactLocation
      ? "name_country_locality"
      : "name_country_candidate",
    evidenceTier: exactLocation ? 3 : 4,
    observedAt: candidate.rowEvidence.at(-1)?.observed_at ?? timestamp,
    organizationId: candidate.row.id,
    polarity: exactLocation ? "positive" : "candidate",
    resolutionId,
    runId: claim.runId,
    sourceKey: "organizations",
    sourceReference: candidate.row.id,
  };
}

export function organizationCandidateEvidence(
  claim: ClaimedProjectionPosition,
  resolutionId: string,
  candidate: OrganizationResolutionCandidate,
  sourceEmployerId: string,
  timestamp: string
) {
  const raw: OrganizationEvidenceSeed[] = [];
  if (candidate.sourceEmployerLink) {
    raw.push({
      evidenceKind: "source_employer_id",
      evidenceTier: 1,
      observedAt: timestamp,
      organizationId: candidate.row.id,
      polarity: "positive",
      resolutionId,
      runId: claim.runId,
      sourceKey: "organization_source_employer_mappings",
      sourceReference: sourceEmployerId,
    });
  }
  if (candidate.row.opportunity_link) {
    raw.push({
      evidenceKind: "explicit_opportunity_link",
      evidenceTier: candidate.acceptedOpportunityLink ? 1 : 4,
      observedAt: timestamp,
      organizationId: candidate.row.id,
      polarity: candidate.acceptedOpportunityLink ? "positive" : "candidate",
      resolutionId,
      runId: claim.runId,
      sourceKey: "organization_opportunities",
      sourceReference: candidate.row.id,
    });
  }
  for (const mapping of candidate.verifiedDomainMappings) {
    raw.push({
      evidenceKind: "employer_domain",
      evidenceTier: 2,
      observedAt: mapping.accepted_at,
      organizationId: candidate.row.id,
      polarity: "positive",
      resolutionId,
      runId: claim.runId,
      sourceKey: "organization_domain_mappings",
      sourceReference: mapping.id,
    });
  }
  if (candidate.exactDomain && candidate.verifiedDomainMappings.length === 0) {
    raw.push({
      evidenceKind: "employer_domain",
      evidenceTier: 4,
      observedAt: candidate.rowEvidence.at(-1)?.observed_at ?? timestamp,
      organizationId: candidate.row.id,
      polarity: "candidate",
      resolutionId,
      runId: claim.runId,
      sourceKey: "organization_evidence",
      sourceReference: normalizeDomain(candidate.row.canonical_domain),
    });
  }
  raw.push(nameCountryEvidence(claim, resolutionId, candidate, timestamp));
  raw.push({
    evidenceKind: "organization_status",
    evidenceTier: candidate.tier,
    observedAt: timestamp,
    organizationId: candidate.row.id,
    polarity: candidate.row.status === "active" ? "positive" : "conflicting",
    resolutionId,
    runId: claim.runId,
    sourceKey: "organizations",
    sourceReference: candidate.row.status,
  });
  return raw;
}

export async function blockedOrganizationResolution(
  resolutionId: string,
  normalizedCompanyName: string,
  assertedCountryCode: string | null,
  resolvedLocality: string
): Promise<OrganizationResolutionArtifact> {
  const candidateDigest = await canonicalSha256([]);
  const evidenceDigest = await canonicalSha256([]);
  const withoutHash = {
    assertedCountryCode,
    candidateCount: 0,
    candidateDigest,
    evidenceCount: 0,
    evidenceDigest,
    normalizedCompanyName,
    reasonCode: "organization_input_schema_invalid" as const,
    resolvedLocality,
    selectedDisplayName: "",
    selectedOrganizationId: null,
    state: "blocked" as const,
  };
  return {
    ...withoutHash,
    candidates: [],
    evidence: [],
    resolutionHash: await canonicalSha256(withoutHash),
    resolutionId,
  };
}
