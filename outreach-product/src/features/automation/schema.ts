import { z } from "zod";
import { OrganizationMarketSegmentSchema } from "../organizations/market-segments";

export const AutomationModeSchema = z.enum(["off", "review", "auto"]);

export const AutomationChannelPolicySchema = z
  .object({
    dailyLimit: z.number().int().min(1),
    mode: AutomationModeSchema,
  })
  .strict();

export const AutomationPolicySchema = z
  .object({
    allowedBoards: z.array(z.string().min(1).max(80)).max(20),
    boardForm: AutomationChannelPolicySchema,
    email: AutomationChannelPolicySchema,
    excludedMarketSegments: z.array(OrganizationMarketSegmentSchema).max(8),
    followUpDelaysDays: z.array(z.number().int().min(1)),
    minimumFit: z.enum(["likely", "strong"]),
    paused: z.boolean(),
    requireKnownCompensation: z.boolean(),
    routeFreshnessDays: z.number().int().min(1),
  })
  .strict();

export type AutomationPolicy = z.infer<typeof AutomationPolicySchema>;

export const defaultAutomationPolicy: AutomationPolicy = {
  allowedBoards: [],
  boardForm: { dailyLimit: 10, mode: "review" },
  email: { dailyLimit: 20, mode: "review" },
  excludedMarketSegments: ["language_center", "training_center"],
  followUpDelaysDays: [],
  minimumFit: "strong",
  paused: false,
  requireKnownCompensation: false,
  routeFreshnessDays: 30,
};
