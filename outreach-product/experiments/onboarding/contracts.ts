import type { ProfileImportProposal } from "../../src/features/onboarding/schema";

export interface ExpectedEducation {
  country: string;
  degree: string;
  field: string;
  institution: string;
  level: string;
}

export interface ExpectedLanguage {
  language: string;
  level: string;
}

export interface ExpectedWorkExperience {
  current: boolean;
  employer: string;
  endDate: string;
  location: string;
  startDate: string;
  title: string;
}

export interface ProfileImportFixture {
  expected: {
    citizenship: string;
    credentials: string[];
    currentLocation: string;
    education: ExpectedEducation[];
    email: string;
    experienceLabel: string;
    fullName: string;
    introduction: string;
    languages: ExpectedLanguage[];
    phone: string;
    skills: string[];
    workExperience: ExpectedWorkExperience[];
  };
  id: string;
  resume: string;
}

export interface ProfileImportCaseResult {
  error?: string;
  fixtureId: string;
  latencyMs: number;
  proposal?: ProfileImportProposal;
}
