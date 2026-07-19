import { z } from "zod";

type JsonObject = Record<string, unknown>;

export function codexOutputJsonSchema(schema: z.ZodType) {
  return normalizeCodexOutputJsonSchema(
    z.toJSONSchema(schema, { target: "draft-2020-12" }) as JsonObject
  );
}

export function normalizeCodexOutputJsonSchema(schema: JsonObject) {
  return normalizeNode(schema) as JsonObject;
}

function normalizeNode(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeNode);
  }
  if (!(value && typeof value === "object")) {
    return value;
  }

  const normalized = Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, normalizeNode(entry)])
  ) as JsonObject;

  // Codex structured output rejects the JSON Schema `uri` format. The Worker
  // still validates returned URLs with the source Zod schema before accepting
  // a task result.
  if (normalized.format === "uri") {
    Reflect.deleteProperty(normalized, "format");
  }

  if (
    normalized.type === "object" &&
    normalized.properties &&
    typeof normalized.properties === "object" &&
    !Array.isArray(normalized.properties)
  ) {
    normalized.required = Object.keys(normalized.properties);
    normalized.additionalProperties = false;
  }

  return normalized;
}
