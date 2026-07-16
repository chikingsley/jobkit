import type { CampaignExecutionMode } from "./schema";

export interface CountryMarketSummary {
  campaignCount: number;
  countryCode: string;
  countryName: string;
  latestSweepAt: string | null;
  latestSweepStatus: string | null;
  openPositionCount: number;
  organizationCount: number;
  verifiedContactCount: number;
}

export interface CountryOpportunitySummary {
  board: string;
  company: string;
  id: string;
  location: string;
  sourceUrl: string;
  title: string;
  userStatus: string | null;
}

export interface CountryOrganizationSummary {
  city: string;
  contactCount: number;
  id: string;
  lastVerifiedAt: string | null;
  marketSegment: string;
  name: string;
  outreachEligibility: string;
  status: string;
  websiteUrl: string;
}

export interface CountryCampaignSummary {
  createdAt: string;
  executionMode: CampaignExecutionMode;
  id: string;
  includeOpenPositions: boolean;
  includeSchoolOutreach: boolean;
  status: string;
  sweepStatus: string | null;
  targetCount: number;
}

export interface CountrySweepSummary {
  completedAt: string | null;
  id: string;
  requestedAt: string;
  status: string;
  taskCounts: Record<string, number>;
}

export interface CountryDetail {
  campaigns: CountryCampaignSummary[];
  countryCode: string;
  countryName: string;
  opportunities: CountryOpportunitySummary[];
  organizations: CountryOrganizationSummary[];
  sweeps: CountrySweepSummary[];
}
