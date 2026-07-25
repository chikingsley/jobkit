import { canonicalSha256 } from "../hash";

export const COMPONENT_MEMBER_DIGEST_DOMAIN =
  "jobkit-public-component-members/reduction-v1";

export const COMPONENT_RELATION_DIGEST_DOMAIN =
  "jobkit-public-component-relations/reduction-v1";

export const COMPONENT_ROOT_DIGEST_DOMAIN =
  "jobkit-public-component-roots/reduction-v1";

export const COMPONENT_CONTROLLER_DIGEST_DOMAIN =
  "jobkit-public-components/reduction-v1";

export const COMPONENT_ID_DIGEST_DOMAIN =
  "jobkit-public-component-id/reduction-v1";

export const FINAL_PHASE_REDUCTION_DOMAINS = {
  canonicalMatch: "jobkit-public-final-canonical-matches/reduction-v1",
  canonicalMatchRequest:
    "jobkit-public-final-canonical-match-request/reduction-v1",
  canonicalRequest: "jobkit-public-final-canonical-requests/reduction-v1",
  mapping: "jobkit-public-final-mappings/reduction-v1",
  publicRoot: "jobkit-public-final-public-roots/reduction-v1",
  relation: "jobkit-public-final-relations/reduction-v1",
  resolution: "jobkit-public-final-resolutions/reduction-v1",
  sourceMapping: "jobkit-public-final-source-mappings/reduction-v1",
} as const;

export function reductionSeed(domain: string) {
  return canonicalSha256({ domain, state: "empty" });
}

export async function appendReductionDigest(
  domain: string,
  priorDigest: null | string,
  records: unknown[]
) {
  let digest = priorDigest ?? (await reductionSeed(domain));
  for (const record of records) {
    // biome-ignore lint/performance/noAwaitInLoops: The row-wise fold is the page-size-independent durable digest contract.
    digest = await canonicalSha256({ domain, previousDigest: digest, record });
  }
  return digest;
}

export function appendFinalPhaseDigest(
  domain: (typeof FINAL_PHASE_REDUCTION_DOMAINS)[keyof typeof FINAL_PHASE_REDUCTION_DOMAINS],
  priorDigest: null | string,
  records: unknown[]
) {
  return appendReductionDigest(domain, priorDigest, records);
}
