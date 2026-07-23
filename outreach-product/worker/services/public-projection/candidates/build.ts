import { buildPublicDescription } from "../../../../src/features/public/description";
import { canonicalSha256 } from "../hash";
import {
  candidateDecision,
  candidateIsPublishable,
  candidateLocations,
  candidateSourceMappings,
  candidateVersion,
  candidateViews,
  publicCompensation,
  publicFields,
  publicJobId,
  publicWorkplaceType,
  slugify,
  sourceAttribution,
  unique,
} from "./derive";
import {
  type CandidateAllocationRow,
  type CandidateSourceRow,
  type PublicProjectionCandidate,
  PublicProjectionCandidateSchema,
} from "./model";
import {
  CandidateInputError,
  readApplicationRoute,
  readCandidatePolicy,
  readCandidatePrimaryInput,
  readCandidateResolution,
  readIdentitySignal,
  readLivePredecessor,
} from "./read-input";

export async function buildProjectionCandidate(
  db: D1Database,
  allocation: CandidateAllocationRow,
  sources: CandidateSourceRow[],
  timestamp: string
): Promise<PublicProjectionCandidate> {
  const primary = await readCandidatePrimaryInput(db, allocation, sources);
  const { locations, organization } = await readCandidateResolution(
    db,
    allocation.run_id,
    primary.source.position_item_id
  );
  const policy = await readCandidatePolicy(
    db,
    primary.source.source_key,
    primary.source.policy_version
  );
  const [live, route, identity] = await Promise.all([
    readLivePredecessor(db, publicJobId(allocation)),
    readApplicationRoute(db, primary.source.listing_id),
    readIdentitySignal(db, allocation.run_id, primary.source.position_item_id),
  ]);
  const storedLocations = candidateLocations(locations);
  const publicLocations = storedLocations.map(
    (location) => location.publicValue
  );
  const workplaceType = publicWorkplaceType(locations);
  const fieldsUsed = publicFields(
    policy.allowedFields,
    primary,
    policy.enabled
  );
  const publishable = candidateIsPublishable(
    policy.enabled,
    fieldsUsed,
    route?.id ?? null
  );
  const description = buildPublicDescription({
    analysis: primary.analysis,
    facts: primary.facts,
    position: primary.position,
  });
  if (description.sections.length === 0) {
    throw new CandidateInputError(
      "candidate_description_empty",
      "The normalized public description is empty"
    );
  }
  const id = publicJobId(allocation);
  const publicJobVersion = (live?.current_version ?? 0) + 1;
  const decisionVersion = (live?.current_decision_version ?? 0) + 1;
  const canonicalSlug = slugify(
    `${primary.position.title}-${organization.selected_display_name}-${publicLocations[0]?.displayName ?? ""}`
  );
  const compensation = publicCompensation(primary.facts, timestamp);
  const employmentTypes = unique(
    primary.position.employmentTypes.map(({ value }) => value)
  );
  const datePosted = primary.snapshot.material.sourceDates.posted;
  const validThrough = primary.snapshot.material.sourceDates.expires;
  const sourcesAttribution = sourceAttribution({
    fieldsUsed,
    materialSourceUrl: primary.snapshot.material.sourceUrl,
    policy,
  });
  const publicContentHash = await canonicalSha256({
    canonicalSlug,
    compensation,
    datePosted,
    description: description.canonicalJson,
    employmentTypes,
    locations: publicLocations,
    organizationId: organization.selected_organization_id,
    title: primary.position.title,
    validThrough,
    workplaceType,
  });
  const { detail, item } = candidateViews({
    canonicalSlug,
    compensation,
    datePosted,
    descriptionHtml: description.html,
    employmentTypes,
    fieldsUsed,
    locations: storedLocations,
    materialChangedAt: primary.snapshot.materialChangedAt,
    organizationName: organization.selected_display_name,
    publicJobId: id,
    publicJobVersion,
    publishable,
    sources: sourcesAttribution,
    timestamp,
    title: primary.position.title,
    validThrough,
    workplaceType,
  });
  const sourceMappings = candidateSourceMappings(
    sources,
    primary.source.source_position_id,
    fieldsUsed
  );
  const semantic = {
    allocationId: allocation.allocation_id,
    applicationRouteId: route?.id ?? null,
    contractVersion: 1 as const,
    decision: candidateDecision({
      decisionVersion,
      predecessorVersion: live?.current_decision_version ?? null,
      publishable,
      routeAvailable: route !== null,
    }),
    detail,
    finalDuplicateSealHash: allocation.final_duplicate_seal_hash,
    identitySignalHash: identity,
    item,
    locations: storedLocations,
    policyHeadsHash: allocation.policy_heads_hash,
    publicContentHash,
    publicJobId: id,
    publicJobVersion,
    publicJobVersionPredecessor: live?.current_version ?? null,
    runId: allocation.run_id,
    sourceMappings,
    sourcePositionId: primary.source.source_position_id,
    sourceWatermarkJson: allocation.source_watermark_json,
    version: candidateVersion({
      canonicalSlug,
      compensation,
      datePosted,
      descriptionHtml: description.html,
      employmentTypes,
      materialChangedAt: primary.snapshot.materialChangedAt,
      organizationId: organization.selected_organization_id,
      organizationName: organization.selected_display_name,
      title: primary.position.title,
      validThrough,
      workplaceType,
    }),
  };
  const semanticHash = await canonicalSha256(semantic);
  return PublicProjectionCandidateSchema.parse({
    ...semantic,
    candidateId: `pcand_v1_${semanticHash}`,
  });
}
