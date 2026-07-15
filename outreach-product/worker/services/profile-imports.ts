import { profileFromImport } from "../../src/features/onboarding/schema";
import { extractProfileProposal } from "../ai/profile-extraction";
import type { AuthUser } from "../app-types";
import type { AppEnv } from "../env";
import { readAiModel } from "../repositories/ai-model-settings";
import {
  createProfileImportRecords,
  failProfileImport,
  finishProfileImport,
} from "../repositories/onboarding";
import { convertResumeToText, RESUME_CONTENT_TYPES } from "./document-text";

export const MAX_RESUME_BYTES = 5 * 1024 * 1024;

export class ResumeUploadError extends Error {
  readonly status: 400 | 413 | 415;

  constructor(message: string, status: 400 | 413 | 415) {
    super(message);
    this.status = status;
  }
}

export async function importResume(
  env: AppEnv,
  user: AuthUser,
  request: Request
) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!RESUME_CONTENT_TYPES.has(contentType)) {
    throw new ResumeUploadError(
      "Use a PDF, DOCX, PPTX, image, Markdown, or text resume",
      415
    );
  }
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (!(contentLength > 0 && contentLength <= MAX_RESUME_BYTES)) {
    throw new ResumeUploadError(
      "Resume files must be between 1 byte and 5 MB",
      413
    );
  }
  const filename = safeFilename(
    decodeURIComponent(request.headers.get("x-jobkit-filename") ?? "resume")
  );
  const bytes = await request.arrayBuffer();
  if (
    bytes.byteLength !== contentLength ||
    bytes.byteLength > MAX_RESUME_BYTES
  ) {
    throw new ResumeUploadError(
      "Resume file size did not match the upload",
      400
    );
  }

  const documentId = crypto.randomUUID();
  const importId = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const objectKey = `users/${user.id}/documents/${documentId}/${filename}`;
  const sourceTextKey = `users/${user.id}/imports/${importId}/source.md`;
  await env.DOCUMENTS.put(objectKey, bytes, {
    httpMetadata: {
      contentDisposition: `inline; filename="${filename}"`,
      contentType,
    },
  });
  try {
    await createProfileImportRecords(env.DB, {
      contentType,
      createdAt,
      documentId,
      filename,
      importId,
      objectKey,
      sizeBytes: bytes.byteLength,
      userId: user.id,
    });
  } catch (error) {
    await env.DOCUMENTS.delete(objectKey);
    throw error;
  }

  let sourceTextStored = false;
  try {
    const [sourceText, model] = await Promise.all([
      convertResumeToText(env, { bytes, contentType, filename }),
      readAiModel(env.DB, "profile_extraction"),
    ]);
    const extraction = await extractProfileProposal(env, model, sourceText);
    await env.DOCUMENTS.put(sourceTextKey, sourceText, {
      httpMetadata: { contentType: "text/markdown; charset=utf-8" },
    });
    sourceTextStored = true;
    await finishProfileImport(env.DB, {
      importId,
      modelId: extraction.modelId,
      modelProvider: extraction.provider,
      proposal: extraction.proposal,
      sourceTextKey,
      updatedAt: new Date().toISOString(),
      userId: user.id,
    });
    return {
      id: importId,
      profile: profileFromImport(extraction.proposal, user),
      proposal: extraction.proposal,
      status: "ready" as const,
    };
  } catch (error) {
    if (sourceTextStored) {
      await env.DOCUMENTS.delete(sourceTextKey);
    }
    await failProfileImport(env.DB, {
      errorMessage: error instanceof Error ? error.message : String(error),
      importId,
      updatedAt: new Date().toISOString(),
      userId: user.id,
    });
    throw error;
  }
}

function safeFilename(value: string) {
  const sanitized = value
    .replaceAll(/[^a-z0-9._ -]/giu, "_")
    .replaceAll(/\s+/gu, " ")
    .slice(0, 120);
  return sanitized || "resume";
}
