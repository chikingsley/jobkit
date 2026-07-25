import type { Job } from "../../features/jobs/types";
import { restrictedMarketSegments } from "../../features/organizations/market-segments";
import type {
  JobMatch,
  MatchCriterion,
  Preferences,
  Profile,
  StoredDocument,
} from "../../profile-types";
import { type QualificationClaims, qualificationClaimKey } from "./claims";
import {
  audienceLabel,
  benefitCriteria,
  criterion,
  employmentLabel,
  positionCriteria,
  preferenceCriterion,
  summarize,
} from "./evaluate/criteria";
import {
  evaluateRequirements,
  matchStateForAnswer,
  requirementState,
} from "./evaluate/requirements";
import type { JobRequirement } from "./schema";

export function evaluateJob(
  job: Job,
  profile: Profile,
  preferences: Preferences,
  monthlySalaryUsd?: number,
  documents: StoredDocument[] = [],
  claims: QualificationClaims = {}
): JobMatch {
  const criteria: MatchCriterion[] = [];
  if (
    job.marketSegments.length > 0 &&
    job.marketSegments.every((segment) => restrictedMarketSegments.has(segment))
  ) {
    criteria.push(
      criterion(
        "Training and language center-only listings are excluded",
        "conflict"
      )
    );
  }
  if (preferences.countries.excluded.includes(job.country)) {
    criteria.push(
      criterion(`${job.country} is excluded in preferences`, "conflict")
    );
  } else if (preferences.countries.preferred.includes(job.country)) {
    criteria.push(criterion(`${job.country} is preferred`, "match"));
  }

  criteria.push(...positionCriteria(job, preferences, profile));

  if (job.matchFacts) {
    criteria.push(
      ...evaluateRequirements(
        job.matchFacts.requirements,
        profile,
        documents,
        claims
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
      criterion(
        "Job requirements have not been analyzed",
        "unknown",
        undefined,
        "internal"
      )
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

export function evaluateRequirement(
  requirement: JobRequirement,
  profile: Profile,
  documents: StoredDocument[],
  claims: QualificationClaims
): MatchCriterion {
  const claimKey = qualificationClaimKey(requirement);
  const claim = claims[claimKey];
  const state = claim
    ? matchStateForAnswer(claim.answer)
    : requirementState(requirement, profile, documents);
  return {
    claimAnswer: claim?.answer,
    claimKey,
    claimKind: requirement.kind,
    evidence: requirement.evidence,
    importance: requirement.importance,
    label: requirement.label,
    state:
      requirement.importance === "preferred" && state !== "match"
        ? "preference"
        : state,
  };
}
