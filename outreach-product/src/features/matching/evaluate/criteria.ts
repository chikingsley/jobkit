import type {
  JobMatch,
  MatchCriterion,
  MatchState,
  Preferences,
  Profile,
} from "../../../profile-types";
import type { Job } from "../../jobs/types";
import { hasConcept } from "./requirements";

export function benefitCriteria(job: Job, preferences: Preferences) {
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

export function positionCriteria(
  job: Job,
  preferences: Preferences,
  profile: Profile
) {
  const analysis = job.positionAnalysis;
  if (!analysis) {
    return [
      criterion(
        "Advertised role has not been classified",
        "unknown",
        undefined,
        "internal"
      ),
    ];
  }
  const positions = analysis.positions.map((position) => ({
    preference: preferences.roles[position.roleFamily],
    roleFamily: position.roleFamily,
    subjects: position.subjects,
    title: position.title,
  }));
  const available = positions.filter(
    ({ preference }) => preference !== "exclude"
  );
  if (available.length === 0) {
    return [
      criterion(
        `None of the ${positions.length} advertised roles match your role preferences`,
        "conflict"
      ),
    ];
  }
  const preferred = available.find(({ preference }) => preference === "prefer");
  if (available.every(({ preference }) => preference === "avoid")) {
    return [criterion("All advertised roles are marked Avoid", "preference")];
  }
  const criteria = preferred
    ? [criterion(`Includes a preferred role: ${preferred.title}`, "match")]
    : [];
  const subjectSpecialists = available.filter(
    (position) => position.roleFamily === "subject_specialist"
  );
  if (subjectSpecialists.length === 0) {
    return criteria;
  }
  if (subjectSpecialists.length < available.length) {
    return criteria;
  }
  const advertisedSubjects = subjectSpecialists.flatMap(
    (position) => position.subjects
  );
  if (advertisedSubjects.length === 0) {
    return [
      ...criteria,
      criterion(
        "The subject-specialist role does not identify a subject",
        "unknown"
      ),
    ];
  }
  if (profile.subjectQualifications.length === 0) {
    return [
      ...criteria,
      criterion(
        `Confirm qualification for ${subjectList(advertisedSubjects.map((subject) => subject.value))}`,
        "unknown",
        advertisedSubjects.map((subject) => subject.evidence).join(" | ")
      ),
    ];
  }
  const qualified = advertisedSubjects.filter((subject) =>
    hasConcept(profile.subjectQualifications, [subject.value])
  );
  if (qualified.length > 0) {
    return [
      ...criteria,
      criterion(
        `Qualified to teach ${subjectList(qualified.map((subject) => subject.value))}`,
        "match",
        qualified.map((subject) => subject.evidence).join(" | ")
      ),
    ];
  }
  return [
    ...criteria,
    criterion(
      `No recorded qualification for ${subjectList(advertisedSubjects.map((subject) => subject.value))}`,
      "conflict",
      advertisedSubjects.map((subject) => subject.evidence).join(" | ")
    ),
  ];
}

function subjectList(subjects: string[]) {
  return [...new Set(subjects)].join(", ");
}

export function preferenceCriterion(
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

export function summarize(criteria: MatchCriterion[]): JobMatch {
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

export function criterion(
  label: string,
  state: MatchState,
  evidence?: string,
  visibility?: MatchCriterion["visibility"]
): MatchCriterion {
  return { evidence, label, state, visibility };
}

export function audienceLabel(value: string) {
  const labels: Record<string, string> = {
    adults: "Adult learners",
    college: "College or university learners",
    preschool: "Preschool learners",
    primary: "Primary learners",
    teenagers: "Teenage learners",
  };
  return labels[value] ?? value;
}

export function employmentLabel(value: string) {
  const labels: Record<string, string> = {
    contract: "Contract work",
    fullTime: "Full-time work",
    partTime: "Part-time work",
  };
  return labels[value] ?? value;
}
