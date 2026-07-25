import { canonicalSha256, compareUtf8Bytes } from "../hash";
import type { ClaimedProjectionPosition } from "../position-items";
import {
  type OrganizationDomainMappingRow,
  type OrganizationEvidenceArtifact,
  type OrganizationReasonCode,
  type OrganizationResolutionCandidate,
  type OrganizationRouteIdentity,
  type OrganizationRow,
  PUBLIC_SUFFIX_LIST_VERSION,
  type ResolutionState,
} from "./model";
import { organizationCandidateEvidence } from "./organization-evidence";
import {
  normalizeDomain,
  normalizedPathPrefix,
  registrableDomainForHost,
} from "./support";

export function organizationEvidenceTier(input: {
  acceptedOpportunityLink: boolean;
  evidenceActive: boolean;
  exactCountry: boolean;
  exactDomain: boolean;
  exactLocality: boolean;
  exactName: boolean;
  sourceEmployerLink: boolean;
  verifiedDomainMapping: boolean;
}) {
  if (input.acceptedOpportunityLink || input.sourceEmployerLink) {
    return 1;
  }
  if (input.verifiedDomainMapping) {
    return 2;
  }
  if (
    input.exactName &&
    input.exactCountry &&
    input.exactLocality &&
    input.evidenceActive
  ) {
    return 3;
  }
  return 4;
}

export function organizationDomainMappingMatches(
  mapping: OrganizationDomainMappingRow,
  organization: OrganizationRow,
  routes: OrganizationRouteIdentity[]
) {
  if (mapping.public_suffix_list_version !== PUBLIC_SUFFIX_LIST_VERSION) {
    return false;
  }
  const mappingHost = normalizeDomain(mapping.normalized_host);
  const mappingRegistrableDomain = normalizeDomain(mapping.registrable_domain);
  const derivedMappingDomain = registrableDomainForHost(mappingHost);
  const canonicalOrganizationDomain = registrableDomainForHost(
    normalizeDomain(organization.canonical_domain)
  );
  if (
    !(mappingHost && mappingRegistrableDomain) ||
    mappingRegistrableDomain !== derivedMappingDomain ||
    !canonicalOrganizationDomain
  ) {
    return false;
  }
  if (mapping.mapping_kind === "employer_host") {
    return (
      mappingRegistrableDomain === canonicalOrganizationDomain &&
      routes.some((route) => route.host === mappingHost)
    );
  }
  if (mapping.mapping_kind === "employer_registrable_domain") {
    return (
      mappingHost === mappingRegistrableDomain &&
      mappingRegistrableDomain === canonicalOrganizationDomain &&
      routes.some(
        (route) => route.registrableDomain === mappingRegistrableDomain
      )
    );
  }
  const prefix = normalizedPathPrefix(mapping.path_prefix);
  return (
    Boolean(prefix) &&
    routes.some(
      (route) =>
        route.host === mappingHost &&
        (route.path === prefix || route.path.startsWith(`${prefix}/`))
    )
  );
}

export function organizationResolutionOutcome(
  candidates: OrganizationResolutionCandidate[],
  selected: OrganizationResolutionCandidate | null,
  conflict: boolean
): { reasonCode: OrganizationReasonCode; state: ResolutionState } {
  if (conflict) {
    return {
      reasonCode: "organization_evidence_conflict",
      state: "ambiguous",
    };
  }
  if (selected?.tier === 1) {
    return {
      reasonCode: selected.sourceEmployerLink
        ? "organization_source_employer_id"
        : "organization_explicit_link",
      state: "resolved",
    };
  }
  if (selected?.tier === 2) {
    return { reasonCode: "organization_employer_domain", state: "resolved" };
  }
  if (selected?.tier === 3) {
    return {
      reasonCode: "organization_name_country_locality",
      state: "resolved",
    };
  }
  const invalidCandidate = candidates.some((candidate) =>
    ["closed", "invalid", "stale", "unverified"].includes(candidate.row.status)
  );
  if (invalidCandidate) {
    return {
      reasonCode: "organization_invalid_candidate",
      state: "unresolved",
    };
  }
  return {
    reasonCode:
      candidates.length > 0
        ? "organization_candidate_only"
        : "organization_no_candidate",
    state: "unresolved",
  };
}

export function organizationEvidenceArtifacts(
  claim: ClaimedProjectionPosition,
  resolutionId: string,
  preliminary: OrganizationResolutionCandidate[],
  sourceEmployerId: string,
  timestamp: string
) {
  const raw: Omit<
    OrganizationEvidenceArtifact,
    "createdAt" | "evidenceHash" | "ordinal"
  >[] = preliminary.flatMap((candidate) =>
    organizationCandidateEvidence(
      claim,
      resolutionId,
      candidate,
      sourceEmployerId,
      timestamp
    )
  );
  raw.sort(
    (left, right) =>
      left.evidenceTier - right.evidenceTier ||
      compareUtf8Bytes(
        `${left.sourceKey}\0${left.evidenceKind}\0${left.observedAt}\0${left.organizationId ?? ""}`,
        `${right.sourceKey}\0${right.evidenceKind}\0${right.observedAt}\0${right.organizationId ?? ""}`
      )
  );
  return Promise.all(
    raw.map(async (row, ordinal) => ({
      ...row,
      createdAt: timestamp,
      evidenceHash: await canonicalSha256(row),
      ordinal,
    }))
  );
}
