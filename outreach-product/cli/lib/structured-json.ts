export interface StructuredJsonPromptOptions {
  outputSchema: object;
  prompt: string;
}

export function structuredJsonPrompt(options: StructuredJsonPromptOptions) {
  return `${options.prompt}

Respond with exactly one JSON object that validates against the JSON Schema inside <output-schema>. Output only the JSON object itself: no markdown fences, no commentary, no additional text.

Honor the schema exactly: emit only keys the schema defines, use only the listed enum values, and never exceed a maxItems or maxLength limit. Drop the lowest-value entries or shorten the text to stay within a limit rather than overflowing it.

<output-schema>
${JSON.stringify(options.outputSchema)}
</output-schema>`;
}

const LEADING_FENCE_PATTERN = /^\s*```(?:json)?/u;
const TRAILING_FENCE_PATTERN = /```\s*$/u;

export function extractJsonObjectText(text: string) {
  const withoutFences = text
    .replace(LEADING_FENCE_PATTERN, "")
    .replace(TRAILING_FENCE_PATTERN, "");
  const start = withoutFences.indexOf("{");
  const end = withoutFences.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("agent reply contained no JSON object");
  }
  return withoutFences.slice(start, end + 1);
}
