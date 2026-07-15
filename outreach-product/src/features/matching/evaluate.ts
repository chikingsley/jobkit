import type { Job } from "@/features/jobs/types";
import type { JobRequirement } from "@/features/matching/schema";
import type {
  JobMatch,
  MatchCriterion,
  MatchState,
  Preferences,
  Profile,
} from "@/profile-types";

const degreeRanks = {
  associate: 1,
  bachelor: 2,
  certificate: 0,
  diploma: 0,
  doctorate: 4,
  master: 3,
  other: 0,
} as const;
const languageRanks = {
  A1: 1,
  A2: 2,
  B1: 3,
  B2: 4,
  C1: 5,
  C2: 6,
  native: 7,
} as const;
const segmenter = new Intl.Segmenter("en", { granularity: "word" });

export function evaluateJob(
  job: Job,
  profile: Profile,
  preferences: Preferences,
  monthlySalaryUsd?: number
): JobMatch {
  const criteria: MatchCriterion[] = [];
  if (preferences.countries.excluded.includes(job.country)) {
    criteria.push(
      criterion(`${job.country} is excluded in preferences`, "conflict")
    );
  } else if (preferences.countries.preferred.includes(job.country)) {
    criteria.push(criterion(`${job.country} is preferred`, "match"));
  }

  if (job.matchFacts) {
    criteria.push(
      ...job.matchFacts.requirements.map((requirement) =>
        evaluateRequirement(requirement, profile)
      ),
      ...job.matchFacts.audiences.map((fact) =>
        preferenceCriterion(
          audienceLabel(fact.value),
          preferences.audiences[fact.value],
          fact.evidence
        )
      ),
      ...job.matchFacts.employmentTypes.map((fact) =>
        preferenceCriterion(
          employmentLabel(fact.value),
          preferences.employment[fact.value],
          fact.evidence
        )
      ),
      ...benefitCriteria(job, preferences)
    );
  } else {
    criteria.push(
      criterion("Job requirements have not been analyzed", "unknown")
    );
  }

  if (preferences.minimumMonthlyUsd > 0) {
    criteria.push(
      monthlySalaryUsd === undefined
        ? criterion("Monthly pay is not confirmed", "unknown")
        : criterion(
            `Monthly pay is below $${preferences.minimumMonthlyUsd.toLocaleString()}`,
            monthlySalaryUsd < preferences.minimumMonthlyUsd
              ? "conflict"
              : "match"
          )
    );
  }
  return summarize(criteria);
}

function evaluateRequirement(
  requirement: JobRequirement,
  profile: Profile
): MatchCriterion {
  const state = requirementState(requirement, profile);
  return {
    evidence: requirement.evidence,
    importance: requirement.importance,
    label: requirement.label,
    state:
      requirement.importance === "preferred" && state !== "match"
        ? "preference"
        : state,
  };
}

function requirementState(
  requirement: JobRequirement,
  profile: Profile
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
  if (requirement.kind === "workAuthorization") {
    const values = [
      profile.citizenship,
      ...profile.workAuthorization.flatMap((entry) => [
        entry.country,
        `${entry.country} ${entry.status}`,
      ]),
    ];
    return hasConcept(values, requirement.values) ? "match" : "unknown";
  }
  if (requirement.kind === "credential") {
    return hasConcept(profile.credentials, requirement.values)
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

function hasConcept(candidates: string[], concepts: string[]) {
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

function benefitCriteria(job: Job, preferences: Preferences) {
  const listed = new Set(
    job.matchFacts?.benefits
      .filter((fact) => fact.level !== "assistance")
      .map((fact) => fact.value)
  );
  const labels = {
    airfare: "Airfare or flight allowance",
    healthInsurance: "Health insurance",
    housing: "Housing",
    paidLeave: "Paid leave",
    professionalDevelopment: "Professional development",
    visaSponsorship: "Visa sponsorship",
  } as const;
  const criteria: MatchCriterion[] = [];
  for (const [key, strength] of Object.entries(preferences.benefits)) {
    const benefit = key as keyof typeof preferences.benefits;
    if (strength === "required") {
      criteria.push(
        criterion(
          listed.has(benefit)
            ? labels[benefit]
            : `${labels[benefit]} is not confirmed`,
          listed.has(benefit) ? "match" : "unknown"
        )
      );
    } else if (strength === "prefer" && listed.has(benefit)) {
      criteria.push(criterion(labels[benefit], "match"));
    }
  }
  return criteria;
}

function preferenceCriterion(
  label: string,
  strength: string,
  evidence: string
): MatchCriterion {
  if (strength === "exclude") {
    return criterion(
      `${label} is excluded in preferences`,
      "conflict",
      evidence
    );
  }
  if (strength === "avoid") {
    return criterion(
      `${label} is marked Avoid in preferences`,
      "preference",
      evidence
    );
  }
  return criterion(label, "match", evidence);
}

function summarize(criteria: MatchCriterion[]): JobMatch {
  const counts = {
    conflict: criteria.filter((item) => item.state === "conflict").length,
    match: criteria.filter((item) => item.state === "match").length,
    preference: criteria.filter((item) => item.state === "preference").length,
    unknown: criteria.filter((item) => item.state === "unknown").length,
  };
  const score = Math.round((counts.match / Math.max(1, criteria.length)) * 100);
  if (counts.conflict > 0) {
    return { criteria, label: "Ineligible", score, tone: "negative" };
  }
  if (counts.preference > 0) {
    return {
      criteria,
      label: "Preference mismatch",
      score,
      tone: "warning",
    };
  }
  if (counts.unknown > 0) {
    return {
      criteria,
      label: "Needs verification",
      score,
      tone: "neutral",
    };
  }
  return {
    criteria,
    label: counts.match >= 3 ? "Strong match" : "Likely match",
    score,
    tone: "positive",
  };
}

function criterion(
  label: string,
  state: MatchState,
  evidence?: string
): MatchCriterion {
  return { evidence, label, state };
}

function audienceLabel(value: string) {
  const labels: Record<string, string> = {
    adults: "Adult learners",
    college: "College or university learners",
    preschool: "Preschool learners",
    primary: "Primary learners",
    teenagers: "Teenage learners",
  };
  return labels[value] ?? value;
}

function employmentLabel(value: string) {
  const labels: Record<string, string> = {
    contract: "Contract work",
    fullTime: "Full-time work",
    partTime: "Part-time work",
  };
  return labels[value] ?? value;
}
