import { z } from "zod";

export const QualificationClaimAnswerSchema = z.enum(["yes", "no"]);
