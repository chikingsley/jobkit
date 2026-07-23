import { z } from "zod";

export const CorpusTestLabTaskInputSchema = z
  .object({
    caseId: z.string().min(1),
    jinaResult: z.record(z.string(), z.unknown()).optional(),
    testLabRunId: z.string().min(1),
  })
  .strict();

export const DocumentTestLabTaskInputSchema = z
  .object({
    documentEtag: z.string().min(1),
    documentId: z.string().min(1),
    documentVersion: z.string().min(1),
    testLabRunId: z.string().min(1),
  })
  .strict();

export class UnclaimableDocumentArtifactError extends Error {}
