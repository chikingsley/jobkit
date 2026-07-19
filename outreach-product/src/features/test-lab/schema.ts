import { z } from "zod";

export const TestLabVariantSchema = z.enum(["codex", "jina", "hybrid"]);

export const TestLabRunRequestSchema = z
  .object({
    caseId: z.string().trim().min(1).max(120),
    variant: TestLabVariantSchema,
  })
  .strict();

export const DocumentBenchmarkVariantSchema = z.enum([
  "deterministic",
  "codex_vision",
  "mistral_ocr",
]);

export const DocumentBenchmarkRunSchema = z
  .object({
    documentId: z.string().trim().min(1),
    expectedText: z.string().max(60_000).default(""),
    variant: DocumentBenchmarkVariantSchema,
  })
  .strict();

export const TestLabPreferenceSchema = z
  .object({
    leftRunId: z.string().trim().min(1),
    notes: z.string().trim().max(2000).default(""),
    preference: z.enum(["left", "right", "tie", "both_bad"]),
    rightRunId: z.string().trim().min(1),
  })
  .strict();

export const TestDeliveryCaptureSchema = z
  .object({
    attachmentDocumentIds: z
      .array(z.string().trim().min(1))
      .max(10)
      .default([]),
    message: z.string().min(1).max(50_000),
    recipient: z.email(),
    subject: z.string().trim().min(1).max(300),
  })
  .strict();

export const TestDeliveryAllowlistSchema = z
  .object({ email: z.email() })
  .strict();

export const TestDeliveryEventSchema = z
  .object({
    detail: z.string().trim().max(2000).default(""),
    eventType: z.enum(["automated_reply", "bounce", "human_reply"]),
  })
  .strict();
