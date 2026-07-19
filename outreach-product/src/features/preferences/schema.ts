import { z } from "zod";

export const PREFERENCES_SCHEMA_VERSION = 3;

export const RuleStrengthSchema = z.enum([
  "exclude",
  "avoid",
  "accept",
  "prefer",
]);
export const BenefitStrengthSchema = z.enum(["accept", "prefer", "required"]);

export type RuleStrength = z.infer<typeof RuleStrengthSchema>;
export type BenefitStrength = z.infer<typeof BenefitStrengthSchema>;

export interface Preferences {
  audiences: {
    adults: RuleStrength;
    college: RuleStrength;
    preschool: RuleStrength;
    primary: RuleStrength;
    teenagers: RuleStrength;
  };
  benefits: {
    airfare: BenefitStrength;
    healthInsurance: BenefitStrength;
    housing: BenefitStrength;
    paidLeave: BenefitStrength;
    professionalDevelopment: BenefitStrength;
    visaSponsorship: BenefitStrength;
  };
  countries: {
    acceptable: string[];
    excluded: string[];
    preferred: string[];
  };
  employment: {
    contract: RuleStrength;
    fullTime: RuleStrength;
    partTime: RuleStrength;
  };
  minimumMonthlyUsd: number;
  roles: {
    early_childhood: RuleStrength;
    english_language: RuleStrength;
    homeroom: RuleStrength;
    leadership: RuleStrength;
    other: RuleStrength;
    student_support: RuleStrength;
    subject_specialist: RuleStrength;
  };
}

const ruleGroup = z
  .object({
    adults: RuleStrengthSchema,
    college: RuleStrengthSchema,
    preschool: RuleStrengthSchema,
    primary: RuleStrengthSchema,
    teenagers: RuleStrengthSchema,
  })
  .strict();

export const PreferencesSchema: z.ZodType<Preferences> = z
  .object({
    audiences: ruleGroup,
    benefits: z
      .object({
        airfare: BenefitStrengthSchema,
        healthInsurance: BenefitStrengthSchema,
        housing: BenefitStrengthSchema,
        paidLeave: BenefitStrengthSchema,
        professionalDevelopment: BenefitStrengthSchema,
        visaSponsorship: BenefitStrengthSchema,
      })
      .strict(),
    countries: z
      .object({
        acceptable: z.array(z.string().max(120)).max(100),
        excluded: z.array(z.string().max(120)).max(100),
        preferred: z.array(z.string().max(120)).max(100),
      })
      .strict(),
    employment: z
      .object({
        contract: RuleStrengthSchema,
        fullTime: RuleStrengthSchema,
        partTime: RuleStrengthSchema,
      })
      .strict(),
    minimumMonthlyUsd: z.number().min(0).max(100_000),
    roles: z
      .object({
        early_childhood: RuleStrengthSchema,
        english_language: RuleStrengthSchema,
        homeroom: RuleStrengthSchema,
        leadership: RuleStrengthSchema,
        other: RuleStrengthSchema,
        student_support: RuleStrengthSchema,
        subject_specialist: RuleStrengthSchema,
      })
      .strict(),
  })
  .strict();

export const defaultPreferences: Preferences = {
  audiences: {
    adults: "accept",
    college: "accept",
    preschool: "accept",
    primary: "accept",
    teenagers: "accept",
  },
  benefits: {
    airfare: "accept",
    healthInsurance: "accept",
    housing: "accept",
    paidLeave: "accept",
    professionalDevelopment: "accept",
    visaSponsorship: "accept",
  },
  countries: {
    acceptable: [],
    excluded: [],
    preferred: [],
  },
  employment: {
    contract: "accept",
    fullTime: "accept",
    partTime: "accept",
  },
  minimumMonthlyUsd: 0,
  roles: {
    early_childhood: "accept",
    english_language: "prefer",
    homeroom: "accept",
    leadership: "exclude",
    other: "avoid",
    student_support: "exclude",
    subject_specialist: "exclude",
  },
};
