import type {
  MatchCriterion,
  MatchState,
  Profile,
  StoredDocument,
} from "../../../profile-types";
import {
  alternativeQualificationClaimKey,
  type QualificationClaims,
} from "../claims";
import { evaluateRequirement } from "../evaluate";
import type { JobRequirement } from "../schema";
import { degreeRanks, languageRanks, segmenter } from "./model";

export function requirementState(
  requirement: JobRequirement,
  profile: Profile,
  documents: StoredDocument[]
): MatchState {
  if (requirement.kind === "degree") {
    return degreeRequirement(requirement, profile);
  }
  if (requirement.kind === "language") {
    return languageRequirement(requirement, profile);
  }
  if (requirement.kind === "residency") {
    return currentValueRequirement(
      profile.currentLocation,
      requirement.values,
      true
    );
  }
  if (requirement.kind === "availability") {
    return currentValueRequirement(
      profile.availability,
      requirement.values,
      false
    );
  }
  return profileEvidenceRequirement(requirement, profile, documents);
}

function profileEvidenceRequirement(
  requirement: JobRequirement,
  profile: Profile,
  documents: StoredDocument[]
): MatchState {
  if (requirement.kind === "workAuthorization") {
    const values = [
      profile.citizenship,
      ...profile.workAuthorization.flatMap((entry) => [
        entry.country,
        `${entry.country} ${entry.status}`,
      ]),
    ];
    return hasCountry(values, requirement.values) ? "match" : "unknown";
  }
  if (requirement.kind === "citizenship") {
    return citizenshipRequirement(requirement, profile);
  }
  if (requirement.kind === "document") {
    const available = documents.flatMap(documentEvidence);
    return hasConcept(available, requirement.values) ? "match" : "unknown";
  }
  if (requirement.kind === "credential") {
    return hasConcept(
      profile.credentials.flatMap(credentialEvidence),
      requirement.values
    )
      ? "match"
      : "unknown";
  }
  if (requirement.kind === "skill") {
    return hasConcept(profileSkillText(profile), requirement.values)
      ? "match"
      : "unknown";
  }
  if (requirement.kind === "experience") {
    return experienceRequirement(requirement, profile);
  }
  return "unknown";
}

function citizenshipRequirement(
  requirement: JobRequirement,
  profile: Profile
): MatchState {
  if (isNativeEnglishRequirement(requirement)) {
    return profile.languages.some(
      (entry) =>
        entry.level === "native" && hasConcept([entry.language], ["English"])
    )
      ? "match"
      : "unknown";
  }
  if (!profile.citizenship) {
    return "unknown";
  }
  return hasCountry([profile.citizenship], requirement.values)
    ? "match"
    : "conflict";
}

function isNativeEnglishRequirement(requirement: JobRequirement) {
  const evidence = [requirement.label, ...requirement.values]
    .join(" ")
    .normalize("NFKC")
    .toLocaleLowerCase("en");
  return evidence.includes("native") && evidence.includes("english");
}

function credentialEvidence(credential: string) {
  const evidence = [credential];
  const credentialTokens = tokens(credential);
  if (
    ["celta", "delta", "tefl", "tesol"].some((name) =>
      credentialTokens.has(name)
    )
  ) {
    evidence.push(
      "English language teaching certificate",
      "certificate in teaching English"
    );
  }
  return evidence;
}

function documentEvidence(document: StoredDocument) {
  const evidence = [
    document.category,
    document.filename,
    `${document.category} ${document.filename}`,
  ];
  if (tokens(document.category).has("resume")) {
    evidence.push("CV", "curriculum vitae");
  }
  return evidence;
}

export function evaluateRequirements(
  requirements: JobRequirement[],
  profile: Profile,
  documents: StoredDocument[],
  claims: QualificationClaims
) {
  const criteria: MatchCriterion[] = [];
  const alternatives = new Map<string, JobRequirement[]>();
  for (const requirement of requirements) {
    if (!requirement.alternativeGroup) {
      criteria.push(
        evaluateRequirement(requirement, profile, documents, claims)
      );
      continue;
    }
    const group = alternatives.get(requirement.alternativeGroup) ?? [];
    group.push(requirement);
    alternatives.set(requirement.alternativeGroup, group);
  }
  for (const [groupName, group] of alternatives) {
    criteria.push(
      evaluateAlternativeRequirement(
        groupName,
        group,
        profile,
        documents,
        claims
      )
    );
  }
  return criteria;
}

function evaluateAlternativeRequirement(
  groupName: string,
  group: JobRequirement[],
  profile: Profile,
  documents: StoredDocument[],
  claims: QualificationClaims
): MatchCriterion {
  const claimKey = alternativeQualificationClaimKey(groupName, group);
  const claim = claims[claimKey];
  const states: MatchState[] = claim
    ? [matchStateForAnswer(claim.answer)]
    : group.map((requirement) =>
        requirementState(requirement, profile, documents)
      );
  let state: MatchState = "conflict";
  if (states.includes("match")) {
    state = "match";
  } else if (states.includes("unknown")) {
    state = "unknown";
  }
  const importance = group.some(
    (requirement) => requirement.importance === "required"
  )
    ? "required"
    : "preferred";
  return {
    claimAnswer: claim?.answer,
    claimKey,
    claimKind: "alternative",
    evidence: group.map((requirement) => requirement.evidence).join(" | "),
    importance,
    label: `${groupName}: ${group.map((requirement) => requirement.label).join(" or ")}`,
    state:
      importance === "preferred" && state !== "match" ? "preference" : state,
  };
}

export function matchStateForAnswer(answer: "yes" | "no"): MatchState {
  return answer === "yes" ? "match" : "conflict";
}

function degreeRequirement(requirement: JobRequirement, profile: Profile) {
  const minimum = requirement.minimumDegreeLevel;
  const eligibleLevel = minimum
    ? profile.education.filter((entry) =>
        minimum === "certificate" ||
        minimum === "diploma" ||
        minimum === "other"
          ? entry.level === minimum
          : degreeRanks[entry.level] >= degreeRanks[minimum]
      )
    : profile.education;
  if (eligibleLevel.length === 0) {
    return profile.education.length > 0 ? "conflict" : "unknown";
  }
  if (requirement.values.length === 0) {
    return "match";
  }
  const fields = eligibleLevel.flatMap((entry) => [entry.field, entry.degree]);
  return hasConcept(fields, requirement.values) ? "match" : "conflict";
}

function languageRequirement(requirement: JobRequirement, profile: Profile) {
  const language = profile.languages.find((entry) =>
    hasConcept([entry.language], requirement.values)
  );
  if (!language) {
    return "unknown";
  }
  const minimum = requirement.minimumLanguageLevel;
  return !minimum || languageRanks[language.level] >= languageRanks[minimum]
    ? "match"
    : "conflict";
}

function experienceRequirement(requirement: JobRequirement, profile: Profile) {
  if (
    requirement.values.length > 0 &&
    !hasConcept(profileSkillText(profile), requirement.values)
  ) {
    return "unknown";
  }
  if (requirement.minimumYears === null) {
    return profile.workExperience.length > 0 ? "match" : "unknown";
  }
  const years = yearsFromLabel(profile.experienceLabel);
  if (years === null) {
    return "unknown";
  }
  return years >= requirement.minimumYears ? "match" : "conflict";
}

function currentValueRequirement(
  current: string,
  values: string[],
  mismatchIsConflict: boolean
): MatchState {
  if (!(current && values.length > 0)) {
    return "unknown";
  }
  if (hasConcept([current], values)) {
    return "match";
  }
  return mismatchIsConflict ? "conflict" : "unknown";
}

function profileSkillText(profile: Profile) {
  return [
    ...profile.fields,
    ...profile.workExperience.flatMap((entry) => [
      entry.title,
      ...entry.highlights,
    ]),
  ];
}

export function hasConcept(candidates: string[], concepts: string[]) {
  if (concepts.length === 0) {
    return false;
  }
  const candidateTokens = candidates.map(tokens);
  return concepts.some((concept) => {
    const required = tokens(concept);
    return (
      required.size > 0 &&
      candidateTokens.some((candidate) =>
        [...required].every((token) => candidate.has(token))
      )
    );
  });
}

function hasCountry(candidates: string[], countries: string[]) {
  const candidateCountries = new Set(candidates.map(canonicalCountry));
  return countries.some((country) =>
    candidateCountries.has(canonicalCountry(country))
  );
}

function canonicalCountry(value: string) {
  const key = [...tokens(value)].join(" ");
  const aliases: Record<string, string> = {
    america: "united states",
    britain: "united kingdom",
    uk: "united kingdom",
    "united states of america": "united states",
    us: "united states",
    usa: "united states",
  };
  return aliases[key] ?? key;
}

function tokens(value: string) {
  return new Set(
    [...segmenter.segment(value.normalize("NFKC").toLocaleLowerCase("en"))]
      .filter((segment) => segment.isWordLike)
      .map((segment) => segment.segment)
  );
}

function yearsFromLabel(label: string) {
  const values = [...tokens(label)];
  if (!(values.includes("year") || values.includes("years"))) {
    return null;
  }
  const years = values.map(Number).find((value) => value >= 0 && value <= 80);
  return years ?? null;
}
