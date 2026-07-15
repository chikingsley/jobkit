import { z } from "zod";

export const AutomationPolicySchema = z
  .object({
    allowedBoards: z.array(z.string().min(1).max(80)).max(20),
    dailyApplicationLimit: z.number().int().min(1).max(25),
    minimumFit: z.enum(["likely", "strong"]),
    mode: z.enum(["off", "draft", "review", "auto"]),
    requireKnownCompensation: z.boolean(),
  })
  .strict();

export type AutomationPolicy = z.infer<typeof AutomationPolicySchema>;

export const defaultAutomationPolicy: AutomationPolicy = {
  allowedBoards: [],
  dailyApplicationLimit: 1,
  minimumFit: "strong",
  mode: "off",
  requireKnownCompensation: false,
};
