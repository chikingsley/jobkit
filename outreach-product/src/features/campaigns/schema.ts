import { z } from "zod";

const COUNTRY_CODE_PATTERN = /^[A-Z]{2}$/u;

export const CampaignStatusSchema = z.enum([
  "preparing",
  "draft",
  "calibrating",
  "ready",
  "running",
  "paused",
  "completed",
  "canceled",
]);

export const CampaignTargetStatusSchema = z.enum([
  "eligible",
  "calibration",
  "ready",
  "claimed",
  "drafted",
  "approved",
  "sent",
  "held",
  "skipped",
  "failed",
  "replied",
]);

export const CampaignCreateSchema = z
  .object({
    countryCodes: z
      .array(z.string().regex(COUNTRY_CODE_PATTERN))
      .min(1)
      .max(3)
      .refine((codes) => new Set(codes).size === codes.length, {
        message: "Choose each country once",
      }),
    dailyPace: z.number().int().positive(),
    firstFiveRequired: z.boolean(),
    name: z.string().trim().max(120).optional(),
    postedTargetPercent: z.number().int().min(0).max(100),
    stopAfterHumanReplies: z.number().int().positive(),
  })
  .strict();

export const CampaignTargetDecisionSchema = z
  .object({
    reason: z.string().trim().max(500).default(""),
    status: z.enum(["approved", "held", "ready"]),
  })
  .strict()
  .refine((value) => value.status !== "held" || value.reason.length > 0, {
    message: "A hold reason is required",
    path: ["reason"],
  });

export const CampaignActionSchema = z
  .object({
    action: z.enum(["begin_calibration", "start", "pause", "resume", "cancel"]),
    reason: z.string().trim().max(500).default(""),
  })
  .strict();

export const CampaignFeedbackSchema = z
  .object({
    dispatchId: z.string().min(1),
    instruction: z.string().trim().min(1).max(1000),
    scope: z.enum(["message", "campaign", "future"]),
  })
  .strict();

export type CampaignAction = z.infer<typeof CampaignActionSchema>;
export type CampaignCreate = z.infer<typeof CampaignCreateSchema>;
export type CampaignFeedback = z.infer<typeof CampaignFeedbackSchema>;
export type CampaignStatus = z.infer<typeof CampaignStatusSchema>;
export type CampaignTargetDecision = z.infer<
  typeof CampaignTargetDecisionSchema
>;
export type CampaignTargetStatus = z.infer<typeof CampaignTargetStatusSchema>;
