import type {
  CampaignStatus,
  CampaignTargetStatus,
} from "@/features/campaigns/schema";

export interface CampaignMarketOption {
  countryCode: string;
  countryName: string;
  latestSweepAt: string | null;
  latestSweepStatus: string | null;
  openPositionCount: number;
  organizationCount: number;
  verifiedContactCount: number;
}

export interface CampaignSetup {
  defaults: {
    dailyPace: number;
    firstFiveRequired: boolean;
    postedTargetPercent: number;
    stopAfterHumanReplies: number;
  };
  liveDeliveryEnabled: boolean;
  markets: CampaignMarketOption[];
}

export interface CampaignCounts {
  advertised: number;
  approved: number;
  calibration: number;
  failed: number;
  held: number;
  humanReplies: number;
  ready: number;
  remaining: number;
  school: number;
  sent: number;
  total: number;
}

export interface CampaignSummary {
  counts: CampaignCounts;
  createdAt: string;
  dailyPace: number;
  id: string;
  liveDeliveryEnabled: boolean;
  markets: Array<{ countryCode: string; countryName: string }>;
  name: string;
  nextRunAt: string | null;
  pauseReason: string;
  status: CampaignStatus;
  stopAfterHumanReplies: number;
  updatedAt: string;
}

export interface CampaignTarget {
  channel: "board_form" | "email" | "external_url" | "manual";
  countryCode: string;
  description: string;
  destination: string;
  holdReason: string;
  id: string;
  label: string;
  matchLabel: string;
  matchScore: number | null;
  routeStrategy: "anesl_bundle" | "single";
  sourceKind: "advertised" | "school";
  sourceUrl: string;
  status: CampaignTargetStatus;
  updatedAt: string;
}

export interface CampaignMessage {
  changeSummary: string;
  createdAt: string;
  dispatchId: string;
  id: string;
  message: string;
  previousMessage: string;
  status: "approved" | "draft" | "sent" | "superseded";
  version: number;
}

export interface CampaignDispatch {
  channel: "board_form" | "email" | "external_url" | "manual";
  id: string;
  message: CampaignMessage | null;
  recipient: string;
  routeStrategy: "anesl_bundle" | "single";
  status: string;
  subject: string;
  targets: CampaignTarget[];
  updatedAt: string;
}

export interface CampaignRun {
  completedAt: string | null;
  dailyPace: number;
  errorDetail: string;
  id: string;
  plannedDispatchCount: number;
  postedTargetPercent: number;
  scheduledFor: string;
  sentDispatchCount: number;
  status: "completed" | "delivering" | "failed" | "generating" | "planning";
}

export interface CampaignReplyEvent {
  classification: "automated" | "bounce" | "human" | "vacation";
  countsTowardPause: boolean;
  dispatchId: string | null;
  id: string;
  receivedAt: string;
}

export interface CampaignDetail extends CampaignSummary {
  dispatches: CampaignDispatch[];
  firstFiveCompletedAt: string | null;
  firstFiveRequired: boolean;
  guidance: Array<{
    createdAt: string;
    id: string;
    instruction: string;
    scope: "campaign" | "future" | "message";
    status: "accepted" | "proposed" | "rejected";
  }>;
  postedTargetPercent: number;
  replies: CampaignReplyEvent[];
  runs: CampaignRun[];
}

export interface CampaignTargetPage {
  hasMore: boolean;
  items: CampaignTarget[];
  nextOffset: number | null;
  total: number;
}
