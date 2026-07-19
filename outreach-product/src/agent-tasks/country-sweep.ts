import { CountrySweepTaskOutputSchema } from "../features/countries/schema";
import { codexOutputJsonSchema } from "./json-schema";

export type CountrySweepPhase = "coverage_audit" | "discovery" | "verification";

export interface CountrySweepAgentInput {
  countryCode: string;
  countryName: string;
  input: unknown;
  phase: CountrySweepPhase;
  scopeKey: string;
}

export const COUNTRY_SWEEP_PROMPT_VERSION = "country-sweep-v3";
export const COUNTRY_SWEEP_OUTPUT_JSON_SCHEMA = codexOutputJsonSchema(
  CountrySweepTaskOutputSchema
);

export function countrySweepTaskType(phase: CountrySweepPhase) {
  return `country_sweep.${phase}`;
}

export function countrySweepModel(phase: CountrySweepPhase) {
  if (phase === "discovery") {
    return { model: "gpt-5.6-terra", reasoningEffort: "medium" as const };
  }
  if (phase === "verification") {
    return { model: "gpt-5.6-luna", reasoningEffort: "medium" as const };
  }
  return { model: "gpt-5.6-sol", reasoningEffort: "high" as const };
}

export function countrySweepPrompt(task: CountrySweepAgentInput) {
  const common = `You are executing one JobKit country-research task.

Country: ${task.countryName} (${task.countryCode})
Phase: ${task.phase}
Scope: ${task.scopeKey}
Input JSON: ${JSON.stringify(task.input)}

Research the live web. Return only facts supported by the URLs you actually checked. Never invent a school, vacancy, email address, phone number, status, or verification date. Use an empty string when a URL or location is unavailable and null when no verification time is justified. Set lastVerifiedAt to the current ISO timestamp only for an organization whose current website or current listing you opened during this run.

Classify language centers and training centers accurately; do not hide them by relabeling. They may be stored but should normally use outreachEligibility "excluded". A real school, kindergarten, university, public school, or international school with a current official contact route may be "eligible". Use "review" when identity or suitability is unclear.

Every active email, phone number, form, or careers page must include the exact evidence URL where it was found. Prefer official organization sites over directories. Report every query, city, and source actually checked in coverageSummary. nextScopes is an actionable list of novel follow-up discovery work: give each scope a source plus an optional city and query. Set needsAnotherPass only when nextScopes contains concrete work. Do not repeat the current scope or invent a numerical stopping target. The final response must follow the supplied JSON schema.`;

  if (task.phase === "discovery") {
    return `${common}

Discover organizations through the assigned source class and any supplied city or query scope. Aim for breadth without duplicates. Record current vacancies when they help establish that the organization is active, but the output is an organization and contact catalog, not prose. Use coverageSummary to report queries or directories checked and useful counts.`;
  }
  if (task.phase === "verification") {
    return `${common}

Verify the single supplied organization against its official current web presence. Return exactly one organization with corrected identity, school type, operating status, outreach eligibility, and current contact points. If it is closed or invalid, say so in status and return only supported contact points.`;
  }
  return `${common}

Audit coverage for the country sweep described by the input. Search for important directories, cities, school categories, or organizations that a broad sweep could miss. Return newly found supported organizations when applicable. When a material gap can be researched, add a concrete novel source, city, and query to nextScopes; otherwise leave nextScopes empty and explain any unresolved gap.`;
}
