import { describe, expect, it } from "vitest";
import { APPLICATION_MESSAGE_OUTPUT_JSON_SCHEMA } from "../../../src/agent-tasks/application-message";
import { COUNTRY_SWEEP_OUTPUT_JSON_SCHEMA } from "../../../src/agent-tasks/country-sweep";
import {
  JOB_MATCH_FACTS_OUTPUT_JSON_SCHEMA,
  JOB_POSITION_OUTPUT_JSON_SCHEMA,
} from "../../../src/agent-tasks/job-analysis";
import { PROFILE_IMPORT_OUTPUT_JSON_SCHEMA } from "../../../src/agent-tasks/profile-import";
import {
  documentOcrOutputJsonSchema,
  testLabOutputJsonSchema,
} from "../../../src/agent-tasks/test-lab";
import { TEST_LAB_CASES } from "../../../src/test-lab/corpus";

const productSchemas = [
  APPLICATION_MESSAGE_OUTPUT_JSON_SCHEMA,
  COUNTRY_SWEEP_OUTPUT_JSON_SCHEMA,
  JOB_MATCH_FACTS_OUTPUT_JSON_SCHEMA,
  JOB_POSITION_OUTPUT_JSON_SCHEMA,
  PROFILE_IMPORT_OUTPUT_JSON_SCHEMA,
  documentOcrOutputJsonSchema(),
];

describe("Codex output schemas", () => {
  it("keeps every product task inside the strict structured-output subset", () => {
    for (const schema of productSchemas) {
      expect(strictSchemaProblems(schema)).toEqual([]);
    }
  });

  it("keeps every Test Lab case inside the strict structured-output subset", () => {
    for (const testCase of TEST_LAB_CASES) {
      expect(strictSchemaProblems(testLabOutputJsonSchema(testCase))).toEqual(
        []
      );
    }
  });
});

function strictSchemaProblems(value: unknown) {
  const problems: string[] = [];
  inspectSchema(value, "$", problems);
  return problems;
}

function inspectSchema(value: unknown, path: string, problems: string[]) {
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) {
      inspectSchema(entry, `${path}[${index}]`, problems);
    }
    return;
  }
  if (!(value && typeof value === "object")) {
    return;
  }

  const node = value as Record<string, unknown>;
  if (node.format === "uri") {
    problems.push(`${path} uses an unsupported URI format`);
  }

  if (node.type === "object") {
    const properties = node.properties as Record<string, unknown> | undefined;
    if (!properties) {
      problems.push(`${path} must declare finite object properties`);
    }
    if (node.additionalProperties !== false) {
      problems.push(`${path} must be closed`);
    }
    if (
      JSON.stringify(node.required) !==
      JSON.stringify(Object.keys(properties ?? {}))
    ) {
      problems.push(`${path} must require every property`);
    }
  }

  for (const [key, entry] of Object.entries(node)) {
    inspectSchema(entry, `${path}.${key}`, problems);
  }
}
