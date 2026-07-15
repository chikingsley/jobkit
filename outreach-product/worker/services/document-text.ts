import { Buffer } from "node:buffer";
import { z } from "zod";
import type { AppEnv } from "../env";

export const RESUME_CONTENT_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/jpeg",
  "image/png",
  "image/webp",
  "text/markdown",
  "text/plain",
]);

const TEXT_CONTENT_TYPES = new Set(["text/markdown", "text/plain"]);
const OFFICE_CONTENT_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
const MAX_RESUME_TEXT_CHARACTERS = 60_000;
const MAX_PROVIDER_RESPONSE_CHARACTERS = 2_000_000;
const MistralFileSchema = z.object({ id: z.string().min(1) }).passthrough();
const MistralSignedUrlSchema = z.object({ url: z.url() }).passthrough();
const MistralOcrResponseSchema = z
  .object({
    model: z.string(),
    pages: z
      .array(
        z
          .object({
            index: z.number().int().nonnegative(),
            markdown: z.string().max(200_000),
          })
          .passthrough()
      )
      .max(100),
  })
  .passthrough();

export class DocumentConversionError extends Error {}

export function convertResumeToText(
  env: AppEnv,
  input: { bytes: ArrayBuffer; contentType: string; filename: string }
): Promise<string> {
  assertFileSignature(input.bytes, input.contentType);
  if (TEXT_CONTENT_TYPES.has(input.contentType)) {
    return Promise.resolve(readableText(new TextDecoder().decode(input.bytes)));
  }

  if (OFFICE_CONTENT_TYPES.has(input.contentType)) {
    return convertUploadedDocument(env, input);
  }

  const type = input.contentType.startsWith("image/")
    ? "image_url"
    : "document_url";
  return convertDocumentUrl(
    env,
    input,
    type,
    `data:${input.contentType};base64,${Buffer.from(input.bytes).toString("base64")}`
  );
}

async function convertUploadedDocument(
  env: AppEnv,
  input: { bytes: ArrayBuffer; contentType: string; filename: string }
) {
  let fileId = "";
  try {
    const form = new FormData();
    form.set(
      "file",
      new Blob([input.bytes], { type: input.contentType }),
      input.filename
    );
    form.set("purpose", "ocr");
    form.set("visibility", "user");
    const upload = await fetch("https://api.mistral.ai/v1/files", {
      body: form,
      headers: mistralHeaders(env),
      method: "POST",
      signal: AbortSignal.timeout(15_000),
    });
    fileId = (
      await parseMistralResponse(upload, MistralFileSchema, input, "upload")
    ).id;
    const signedUrlResponse = await fetch(
      `https://api.mistral.ai/v1/files/${encodeURIComponent(fileId)}/url?expiry=1`,
      {
        headers: mistralHeaders(env),
        signal: AbortSignal.timeout(15_000),
      }
    );
    const { url } = await parseMistralResponse(
      signedUrlResponse,
      MistralSignedUrlSchema,
      input,
      "signed_url"
    );
    return await convertDocumentUrl(env, input, "document_url", url);
  } finally {
    if (fileId) {
      await deleteMistralFile(env, fileId, input.filename);
    }
  }
}

async function convertDocumentUrl(
  env: AppEnv,
  input: { bytes: ArrayBuffer; contentType: string; filename: string },
  type: "document_url" | "image_url",
  url: string
) {
  const response = await fetch("https://api.mistral.ai/v1/ocr", {
    body: JSON.stringify({
      document: {
        [type]: url,
        type,
      },
      image_limit: 0,
      include_image_base64: false,
      model: "mistral-ocr-latest",
    }),
    headers: mistralHeaders(env, true),
    method: "POST",
    signal: AbortSignal.timeout(45_000),
  });
  const result = await parseMistralResponse(
    response,
    MistralOcrResponseSchema,
    input,
    "ocr"
  );
  return readableText(
    result.pages
      .toSorted((left, right) => left.index - right.index)
      .map((page) => page.markdown.trim())
      .filter(Boolean)
      .join("\n\n")
  );
}

async function parseMistralResponse<T>(
  response: Response,
  schema: z.ZodType<T>,
  input: { filename: string },
  stage: "ocr" | "signed_url" | "upload"
): Promise<T> {
  if (!response.ok) {
    console.error(
      JSON.stringify({
        event: "document_conversion_failed",
        filename: input.filename,
        provider: "mistral",
        stage,
        status: response.status,
      })
    );
    throw new DocumentConversionError(
      `Document conversion failed during ${stage}`
    );
  }
  try {
    const responseText = await response.text();
    if (responseText.length > MAX_PROVIDER_RESPONSE_CHARACTERS) {
      throw new Error("Provider response exceeded the expected size");
    }
    return schema.parse(JSON.parse(responseText));
  } catch (error) {
    console.error(
      JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
        event: "document_conversion_response_invalid",
        filename: input.filename,
        provider: "mistral",
        stage,
      })
    );
    throw new DocumentConversionError(
      "The document conversion provider returned an invalid response",
      { cause: error }
    );
  }
}

async function deleteMistralFile(
  env: AppEnv,
  fileId: string,
  filename: string
) {
  try {
    const response = await fetch(
      `https://api.mistral.ai/v1/files/${encodeURIComponent(fileId)}`,
      {
        headers: mistralHeaders(env),
        method: "DELETE",
        signal: AbortSignal.timeout(15_000),
      }
    );
    if (!response.ok) {
      throw new Error(`Mistral returned status ${response.status}`);
    }
  } catch (error) {
    console.error(
      JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
        event: "document_conversion_cleanup_failed",
        filename,
        provider: "mistral",
      })
    );
  }
}

function mistralHeaders(env: AppEnv, json = false) {
  const headers: Record<string, string> = {
    authorization: `Bearer ${env.MISTRAL_API_KEY}`,
  };
  if (json) {
    headers["content-type"] = "application/json";
  }
  return headers;
}

function readableText(value: string) {
  const text = value.trim();
  if (text.length < 80) {
    throw new DocumentConversionError(
      "The resume did not contain enough readable text"
    );
  }
  if (text.length > MAX_RESUME_TEXT_CHARACTERS) {
    throw new DocumentConversionError(
      "The resume contained more readable text than expected"
    );
  }
  return text;
}

function assertFileSignature(bytes: ArrayBuffer, contentType: string) {
  if (TEXT_CONTENT_TYPES.has(contentType)) {
    return;
  }
  const value = new Uint8Array(bytes);
  const matches = (...signature: number[]) =>
    signature.every((byte, index) => value[index] === byte);
  const matchesAscii = (text: string, offset = 0) =>
    Array.from(text).every(
      (character, index) => value[offset + index] === character.charCodeAt(0)
    );
  const valid =
    (contentType === "application/pdf" && matchesAscii("%PDF-")) ||
    (contentType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" &&
      matches(0x50, 0x4b)) ||
    (contentType ===
      "application/vnd.openxmlformats-officedocument.presentationml.presentation" &&
      matches(0x50, 0x4b)) ||
    (contentType === "image/jpeg" && matches(0xff, 0xd8, 0xff)) ||
    (contentType === "image/png" &&
      matches(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) ||
    (contentType === "image/webp" &&
      matchesAscii("RIFF") &&
      matchesAscii("WEBP", 8));
  if (!valid) {
    throw new DocumentConversionError(
      "The file contents did not match the selected file type"
    );
  }
}
