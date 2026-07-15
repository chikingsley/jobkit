import type { AppEnv } from "../env";

export const RESUME_CONTENT_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

export class DocumentConversionError extends Error {}

export async function convertResumeToText(
  env: AppEnv,
  input: { bytes: ArrayBuffer; contentType: string; filename: string }
): Promise<string> {
  const conversion = await env.AI.toMarkdown(
    {
      blob: new Blob([input.bytes], { type: input.contentType }),
      name: input.filename,
    },
    {
      conversionOptions: {
        docx: { images: { convert: false } },
        pdf: { images: { convert: false }, metadata: false },
      },
    }
  );
  if (conversion.format === "error") {
    throw new DocumentConversionError(conversion.error);
  }
  const text = conversion.data.trim();
  if (text.length < 80) {
    throw new DocumentConversionError(
      "The resume did not contain enough readable text"
    );
  }
  return text;
}
