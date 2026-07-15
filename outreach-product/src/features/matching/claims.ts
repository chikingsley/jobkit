import { z } from "zod";
import type { JobRequirement } from "@/features/matching/schema";

export const QualificationClaimAnswerSchema = z.enum(["yes", "no"]);
export type QualificationClaimAnswer = z.infer<
  typeof QualificationClaimAnswerSchema
>;

export interface QualificationClaim {
  answer: QualificationClaimAnswer;
  claimKey: string;
  kind: string;
  label: string;
  updatedAt: string;
}

export type QualificationClaims = Record<string, QualificationClaim>;

export function qualificationClaimKey(requirement: JobRequirement): string {
  return canonicalClaimKey({
    kind: requirement.kind,
    minimumDegreeLevel: requirement.minimumDegreeLevel,
    minimumLanguageLevel: requirement.minimumLanguageLevel,
    minimumYears: requirement.minimumYears,
    values: requirement.values,
  });
}

export function alternativeQualificationClaimKey(
  groupName: string,
  requirements: JobRequirement[]
): string {
  return canonicalClaimKey({
    alternatives: requirements
      .map(qualificationClaimKey)
      .sort((left, right) => left.localeCompare(right)),
    group: normalize(groupName),
    kind: "alternative",
  });
}

function canonicalClaimKey(value: Record<string, unknown>): string {
  const entries = Object.keys(value)
    .sort((left, right) => left.localeCompare(right))
    .flatMap((key) => {
      const entry = value[key];
      return entry === null || entry === undefined
        ? []
        : ([[key, normalizeValue(entry)]] as const);
    });
  return JSON.stringify(Object.fromEntries(entries));
}

function normalizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value
      .map(normalizeValue)
      .sort((left, right) => String(left).localeCompare(String(right)));
  }
  return typeof value === "string" ? normalize(value) : value;
}

function normalize(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en");
}
