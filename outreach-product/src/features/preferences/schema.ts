import { z } from "zod";

export const PREFERENCES_SCHEMA_VERSION = 2;

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
  })
  .strict();

export const defaultPreferences: Preferences = {
  audiences: {
    adults: "prefer",
    college: "prefer",
    preschool: "avoid",
    primary: "accept",
    teenagers: "prefer",
  },
  benefits: {
    airfare: "prefer",
    healthInsurance: "prefer",
    housing: "prefer",
    paidLeave: "prefer",
    professionalDevelopment: "accept",
    visaSponsorship: "prefer",
  },
  countries: {
    acceptable: [
      "Albania",
      "Azerbaijan",
      "Bulgaria",
      "China",
      "Georgia",
      "Kazakhstan",
      "Romania",
    ],
    excluded: [],
    preferred: ["Hungary", "Poland", "Tajikistan", "Oman"],
  },
  employment: {
    contract: "accept",
    fullTime: "prefer",
    partTime: "accept",
  },
  minimumMonthlyUsd: 0,
};
