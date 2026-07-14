import { curatedJobs } from "@/curated-jobs";
import type {
  JobMatch,
  MatchCriterion,
  Preferences,
  Profile,
} from "@/profile-types";

const has = (values: string[], pattern: RegExp) =>
  values.some((value) => pattern.test(value));

const BENEFIT_PATTERNS: Record<string, [string, RegExp]> = {
  airfare: [
    "Airfare or flight allowance",
    /airfare|flight allowance|flights?/i,
  ],
  healthInsurance: ["Health insurance", /health|medical insurance/i],
  housing: ["Housing", /housing|accommodation/i],
  paidLeave: ["Paid leave", /paid leave|paid vacation|holiday pay/i],
  professionalDevelopment: [
    "Professional development",
    /professional development|teacher training|methodology course/i,
  ],
  visaSponsorship: ["Visa sponsorship", /visa sponsorship|sponsor.*visa/i],
};

export function evaluateJob(
  jobId: string,
  country: string,
  profile: Profile,
  preferences: Preferences,
  monthlySalaryUsd?: number
): JobMatch {
  const education = profile.education.map(
    (item) => `${item.level} ${item.degree} ${item.field} ${item.institution}`
  );
  const languages = profile.languages.map(
    (item) => `${item.language} ${item.level}`
  );
  const workAuthorization = profile.workAuthorization.map(
    (item) => `${item.country} ${item.status}`
  );
  const profileText = [
    ...profile.credentials,
    ...education,
    ...profile.fields,
  ].join(" ");
  const hasEnglishEducationDegree = education.some((item) =>
    /(?:bachelor|degree).*(?:english|education|tesol|elt|linguistics)/i.test(
      item
    )
  );
  const rules: Record<string, MatchCriterion[]> = {
    "265443": [
      criterion(
        "TEFL or teaching certificate",
        /tefl|education certificate/i.test(profileText)
      ),
      criterion("Degree", /bachelor/i.test(profileText)),
    ],
    "268901": [
      conflict(
        "BA in English, Education, or TESOL",
        !hasEnglishEducationDegree
      ),
      criterion("TEFL qualification", /tefl/i.test(profileText)),
      unknown("IELTS-instruction experience not confirmed"),
    ],
    "273333": [
      criterion("CELTA, TESOL, or TEFL", /tefl|tesol|celta/i.test(profileText)),
      criterion("Bachelor’s degree", /bachelor/i.test(profileText)),
      criterion("Native-level English", has(languages, /english.*native/i)),
      criterion(
        "At least one year of teaching",
        /five|7\+|more than/i.test(profile.experienceLabel)
      ),
    ],
    "274594": [
      conflict(
        "Degree in English, ELT, or Applied Linguistics",
        !hasEnglishEducationDegree
      ),
      criterion("Native-level English", has(languages, /english.*native/i)),
    ],
    "275878": [
      criterion("Native English speaker", has(languages, /english.*native/i)),
      preference("Young children", preferences.audiences.primary),
      preference("Japan", countryPreference(country, preferences)),
    ],
    "278664": [
      criterion("Bachelor’s degree", /bachelor/i.test(profileText)),
      criterion(
        "ESL or child-teaching experience",
        /english|children/i.test(profileText)
      ),
    ],
    "279052": [
      conflict(
        "Existing Japanese work visa",
        !has(workAuthorization, /japan/i)
      ),
      criterion("Native English speaker", has(languages, /english.*native/i)),
      preference("Preschool learners", preferences.audiences.preschool),
    ],
    "279428": [
      conflict(
        "EU citizenship or work permit",
        !has(workAuthorization, /eu|romania/i)
      ),
      criterion("English-teaching experience", /english/i.test(profileText)),
    ],
    "279778": [
      conflict(
        "Already in Japan or able to begin immediately",
        !/japan/i.test(profile.currentLocation)
      ),
      criterion("No prior teaching experience required", true),
      preference("Japan", countryPreference(country, preferences)),
    ],
    "280312": [
      criterion("Bachelor’s degree", /bachelor/i.test(profileText)),
      conflict(
        "Legal working status in Poland",
        !has(workAuthorization, /poland/i)
      ),
      conflict(
        "Currently residing in Poland",
        !/poland/i.test(profile.currentLocation)
      ),
    ],
    "280321": [
      criterion("Bachelor’s degree", /bachelor/i.test(profileText)),
      criterion(
        "Teaching experience or certification",
        /certificate|english/i.test(profileText)
      ),
      criterion("Native-level English", has(languages, /english.*native/i)),
      unknown(
        "Current criminal-record document should be checked for employer acceptance"
      ),
    ],
    "280355": [
      criterion("Bachelor’s degree", /bachelor/i.test(profileText)),
      criterion(
        "Teaching experience or certification",
        /certificate|english/i.test(profileText)
      ),
      criterion("Native-level English", has(languages, /english.*native/i)),
      unknown("Confirm whether this is a classroom or headteacher vacancy"),
    ],
    "280365": [
      conflict(
        "Currently in Japan with work visa",
        !has(workAuthorization, /japan/i)
      ),
      criterion("Bachelor’s degree", /bachelor/i.test(profileText)),
      criterion("Teaching license", /certificate/i.test(profileText)),
      unknown("Four years specifically teaching children not confirmed"),
      preference("Preschool learners", preferences.audiences.preschool),
    ],
    "280366": [
      criterion(
        "Relevant science degree",
        /chemical engineering|biology|chemistry/i.test(profileText)
      ),
      criterion(
        "Recognized teaching qualification",
        /education certificate|substitute certificate|subject matter expert/i.test(
          profileText
        )
      ),
    ],
  };
  const criteria = rules[jobId] ?? [
    unknown("Requirements have not been mapped yet"),
  ];
  if (preferences.countries.excluded.includes(country)) {
    criteria.push({
      label: `${country} is excluded in preferences`,
      state: "conflict",
    });
  }
  if (preferences.minimumMonthlyUsd > 0) {
    criteria.push(
      monthlySalaryUsd === undefined
        ? unknown("Monthly pay is not confirmed")
        : conflict(
            `Monthly pay is below $${preferences.minimumMonthlyUsd.toLocaleString()}`,
            monthlySalaryUsd < preferences.minimumMonthlyUsd
          )
    );
  }
  const listingText = (curatedJobs[jobId] ?? [])
    .flatMap((section) => section.items)
    .join(" ");
  criteria.push(...benefitCriteria(preferences, listingText));
  return summarize(criteria);
}

function benefitCriteria(preferences: Preferences, listingText: string) {
  const criteria: MatchCriterion[] = [];
  for (const [key, strength] of Object.entries(preferences.benefits)) {
    const benefit = BENEFIT_PATTERNS[key];
    if (!benefit) {
      continue;
    }
    const [label, pattern] = benefit;
    const listed = pattern.test(listingText);
    if (strength === "required") {
      criteria.push(
        listed ? criterion(label, true) : unknown(`${label} is not confirmed`)
      );
    } else if (strength === "prefer" && listed) {
      criteria.push(criterion(label, true));
    }
  }
  return criteria;
}

function summarize(criteria: MatchCriterion[]): JobMatch {
  const hardConflict = criteria.some((item) => item.state === "conflict");
  const preferenceMismatch = criteria.some(
    (item) => item.state === "preference"
  );
  const unknowns = criteria.some((item) => item.state === "unknown");
  if (hardConflict) {
    return { criteria, label: "Ineligible", tone: "negative" };
  }
  if (preferenceMismatch) {
    return { criteria, label: "Preference mismatch", tone: "warning" };
  }
  if (unknowns) {
    return { criteria, label: "Needs verification", tone: "neutral" };
  }
  const matches = criteria.filter((item) => item.state === "match").length;
  return {
    criteria,
    label: matches >= 3 ? "Strong match" : "Likely match",
    tone: "positive",
  };
}

function criterion(label: string, value: boolean): MatchCriterion {
  return value ? { label, state: "match" } : { label, state: "unknown" };
}

function conflict(label: string, value: boolean): MatchCriterion {
  return value ? { label, state: "conflict" } : { label, state: "match" };
}

function unknown(label: string): MatchCriterion {
  return { label, state: "unknown" };
}

function preference(
  label: string,
  strength: string | undefined
): MatchCriterion {
  if (strength === "exclude") {
    return {
      label: `${label} is excluded in preferences`,
      state: "conflict",
    };
  }
  if (strength === "avoid") {
    return {
      label: `${label} is marked Avoid in preferences`,
      state: "preference",
    };
  }
  return { label, state: "match" };
}

function countryPreference(country: string, preferences: Preferences) {
  if (preferences.countries.excluded.includes(country)) {
    return "exclude";
  }
  return preferences.countries.preferred.includes(country)
    ? "prefer"
    : "accept";
}
