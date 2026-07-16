import { z } from "zod";

export const AutomationModeSchema = z.enum(["off", "review", "auto"]);

export const AutomationChannelPolicySchema = z
  .object({
    dailyLimit: z.number().int().min(1).max(100),
    mode: AutomationModeSchema,
  })
  .strict();

const AutomationMarketSegmentSchema = z.enum([
  "international_school",
  "kindergarten",
  "language_center",
  "private_school",
  "public_school",
  "school",
  "training_center",
  "university",
]);

export const AutomationPolicySchema = z
  .object({
    allowedBoards: z.array(z.string().min(1).max(80)).max(20),
    boardForm: AutomationChannelPolicySchema,
    email: AutomationChannelPolicySchema,
    excludedMarketSegments: z.array(AutomationMarketSegmentSchema).max(8),
    minimumFit: z.enum(["likely", "strong"]),
    paused: z.boolean(),
    requireKnownCompensation: z.boolean(),
    routeFreshnessDays: z.number().int().min(1).max(90),
  })
  .strict();

export type AutomationPolicy = z.infer<typeof AutomationPolicySchema>;

export const defaultAutomationPolicy: AutomationPolicy = {
  allowedBoards: [],
  boardForm: { dailyLimit: 10, mode: "review" },
  email: { dailyLimit: 20, mode: "review" },
  excludedMarketSegments: ["language_center", "training_center"],
  minimumFit: "strong",
  paused: false,
  requireKnownCompensation: false,
  routeFreshnessDays: 30,
};
