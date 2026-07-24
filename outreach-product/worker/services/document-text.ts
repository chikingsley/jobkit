import { Buffer } from "node:buffer";
import { z } from "zod";
import { MODEL_PROVIDERS, resolveModel } from "../../src/model/registry";
import type { AppEnv } from "../env";

const MISTRAL_API = MODEL_PROVIDERS.mistral.baseUrl;
const MISTRAL_OCR_MODEL = resolveModel("documentOcr").model;

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
const DOCX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PPTX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";
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

export interface DocumentTextConversion {
  detail: string;
  provider: "deterministic" | "mistral";
  text: string;
}

export interface DocumentTextPage {
  index: number;
  markdown: string;
}

export interface DocumentTextBenchmark extends DocumentTextConversion {
  pages: DocumentTextPage[];
}

export async function convertResumeToText(
  env: AppEnv,
  input: { bytes: ArrayBuffer; contentType: string; filename: string }
) {
  const deterministic = await extractDocumentDeterministically(input);
  if (deterministic) {
    return deterministic;
  }
  const mistral = await runMistralDocumentOcr(env, input);
  return { ...mistral, text: readableText(mistral.text) };
}

export async function extractDocumentDeterministically(input: {
  bytes: ArrayBuffer;
  contentType: string;
  filename: string;
}): Promise<DocumentTextBenchmark | null> {
  assertFileSignature(input.bytes, input.contentType);
  if (TEXT_CONTENT_TYPES.has(input.contentType)) {
    const text = readableText(new TextDecoder().decode(input.bytes));
    return {
      detail: "plain-text",
      pages: [{ index: 0, markdown: text }],
      provider: "deterministic",
      text,
    };
  }
  if (input.contentType === "application/pdf") {
    return await deterministicPdfText(input);
  }
  if (input.contentType === DOCX_CONTENT_TYPE) {
    return await deterministicDocxText(input);
  }
  return null;
}

export async function runMistralDocumentOcr(
  env: AppEnv,
  input: { bytes: ArrayBuffer; contentType: string; filename: string }
): Promise<DocumentTextBenchmark> {
  assertFileSignature(input.bytes, input.contentType);
  if (
    input.contentType === DOCX_CONTENT_TYPE ||
    input.contentType === PPTX_CONTENT_TYPE
  ) {
    return await convertUploadedDocument(env, input);
  }
  const type = input.contentType.startsWith("image/")
    ? "image_url"
    : "document_url";
  return await convertDocumentUrl(
    env,
    input,
    type,
    `data:${input.contentType};base64,${Buffer.from(input.bytes).toString("base64")}`
  );
}

async function deterministicPdfText(input: {
  bytes: ArrayBuffer;
  contentType: string;
  filename: string;
}): Promise<DocumentTextBenchmark | null> {
  try {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const document = await getDocumentProxy(new Uint8Array(input.bytes));
    const result = await extractText(document, { mergePages: false });
    const pages = result.text.map((pageText, index) => ({
      index,
      markdown: pageText.trim(),
    }));
    const text = readableText(
      pages
        .map((page) => page.markdown)
        .filter(Boolean)
        .join("\n\n")
    );
    if (!text) {
      return null;
    }
    return { detail: "unpdf", pages, provider: "deterministic", text };
  } catch (error) {
    logDeterministicFailure(input.filename, "unpdf", error);
    return null;
  }
}

async function deterministicDocxText(input: {
  bytes: ArrayBuffer;
  contentType: string;
  filename: string;
}): Promise<DocumentTextBenchmark | null> {
  try {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ arrayBuffer: input.bytes });
    const text = readableText(result.value);
    if (!text) {
      return null;
    }
    return {
      detail: "mammoth",
      pages: [{ index: 0, markdown: text }],
      provider: "deterministic",
      text,
    };
  } catch (error) {
    logDeterministicFailure(input.filename, "mammoth", error);
    return null;
  }
}

function logDeterministicFailure(
  filename: string,
  extractor: string,
  error: unknown
) {
  console.info(
    JSON.stringify({
      error: error instanceof Error ? error.message : String(error),
      event: "deterministic_document_extraction_unavailable",
      extractor,
      filename,
    })
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
    const upload = await fetch(`${MISTRAL_API}/files`, {
      body: form,
      headers: mistralHeaders(env),
      method: "POST",
      signal: AbortSignal.timeout(15_000),
    });
    fileId = (
      await parseMistralResponse(upload, MistralFileSchema, input, "upload")
    ).id;
    const signedUrlResponse = await fetch(
      `${MISTRAL_API}/files/${encodeURIComponent(fileId)}/url?expiry=1`,
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
  const response = await fetch(`${MISTRAL_API}/ocr`, {
    body: JSON.stringify({
      document: {
        [type]: url,
        type,
      },
      image_limit: 0,
      include_image_base64: false,
      model: MISTRAL_OCR_MODEL,
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
  const pages = result.pages
    .toSorted((left, right) => left.index - right.index)
    .map((page) => ({ index: page.index, markdown: page.markdown.trim() }));
  const text = boundedText(
    pages
      .map((page) => page.markdown)
      .filter(Boolean)
      .join("\n\n")
  );
  return {
    detail: result.model,
    pages,
    provider: "mistral" as const,
    text,
  };
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
      `${MISTRAL_API}/files/${encodeURIComponent(fileId)}`,
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
  const text = boundedText(value);
  if (text.length < 80) {
    throw new DocumentConversionError(
      "The resume did not contain enough readable text"
    );
  }
  return text;
}

function boundedText(value: string) {
  const text = value.trim();
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
