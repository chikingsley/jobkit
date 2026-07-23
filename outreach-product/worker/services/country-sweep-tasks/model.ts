export const MAX_LEGACY_OUTPUT_BYTES = 1_000_000;

export const MAX_LEGACY_OUTPUT_RECORDS = 1000;

export const WWW_PREFIX_PATTERN = /^www\./u;

export interface CompletionTaskRow {
  country_code: string;
  country_name: string;
  phase: "coverage_audit" | "discovery" | "verification";
  scope_key: string;
}

export interface NormalizedContact {
  evidenceUrl: string;
  id: string;
  kind: string;
  label: string;
  status: string;
  value: string;
}

export interface NormalizedOrganization {
  canonicalDomain: string;
  city: string;
  contactPoints: NormalizedContact[];
  evidenceId: string;
  evidenceUrl: string;
  id: string;
  identityKey: string;
  lastVerifiedAt: string | null;
  marketSegment: string;
  name: string;
  outreachEligibility: string;
  region: string;
  status: string;
  websiteUrl: string;
}

export interface PreparedFollowUpTask {
  id: string;
  inputHash: string;
  inputJson: string;
  scopeKey: string;
}
