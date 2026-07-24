import { describe, expect, it } from "bun:test";
import { finalAssistantText } from "../../cli/lib/opencode-agent";
import {
  extractJsonObjectText,
  structuredJsonPrompt,
} from "../../cli/lib/structured-json";
import { resolveAssignment } from "../../src/model/registry";

const NO_JSON_OBJECT_PATTERN = /no JSON object/u;
const ASSIGNMENT_SHAPE_PATTERN = /provider:model/u;
const UNKNOWN_PROVIDER_PATTERN = /Unknown model provider/u;

describe("resolveAssignment", () => {
  it("routes emails to Mistral and analysis to the local model", () => {
    expect(resolveAssignment("application.message")).toMatchObject({
      model: "mistral-medium-latest",
      provider: "mistral",
    });
    expect(resolveAssignment("job.content_analysis")).toMatchObject({
      model: "qwen35-9b-ud-q4-k-xl",
      provider: "localLlama",
    });
    expect(resolveAssignment("job.match_facts").provider).toBe("localLlama");
  });

  it("routes OCR to the Mistral OCR model", () => {
    expect(resolveAssignment("document.ocr").model).toBe("mistral-ocr-latest");
  });

  it("falls back to the default for country sweeps and unknown tasks", () => {
    expect(resolveAssignment("country_sweep.contacts").provider).toBe(
      "mistral"
    );
    expect(resolveAssignment("mystery.task").provider).toBe("mistral");
  });

  it("honors a one-line JOBKIT_MODEL override for a single task", () => {
    expect(
      resolveAssignment("application.message", {
        "JOBKIT_MODEL_application.message": "localLlama:qwen4-32b",
      })
    ).toMatchObject({ model: "qwen4-32b", provider: "localLlama" });
  });

  it("selects a CLI provider the same one-line way", () => {
    expect(
      resolveAssignment("job.match_facts", {
        "JOBKIT_MODEL_job.match_facts": "opencode:opencode-go/glm-5.2",
      })
    ).toMatchObject({ model: "opencode-go/glm-5.2", provider: "opencode" });
  });

  it("rejects a malformed or unknown assignment", () => {
    expect(() =>
      resolveAssignment("x", { JOBKIT_MODEL_x: "no-colon" })
    ).toThrow(ASSIGNMENT_SHAPE_PATTERN);
    expect(() =>
      resolveAssignment("x", { JOBKIT_MODEL_x: "ghost:model" })
    ).toThrow(UNKNOWN_PROVIDER_PATTERN);
  });
});

describe("finalAssistantText", () => {
  it("joins the text parts of the final message only", () => {
    const stdout = [
      JSON.stringify({
        part: { messageID: "m1", text: "draft", type: "text" },
        type: "text",
      }),
      JSON.stringify({ part: { type: "step-finish" }, type: "step_finish" }),
      JSON.stringify({
        part: { messageID: "m2", text: '{"ok":', type: "text" },
        type: "text",
      }),
      JSON.stringify({
        part: { messageID: "m2", text: "true}", type: "text" },
        type: "text",
      }),
      "not json",
    ].join("\n");
    expect(finalAssistantText(stdout)).toBe('{"ok":true}');
  });

  it("returns an empty string when no text events exist", () => {
    expect(finalAssistantText("")).toBe("");
  });
});

describe("extractJsonObjectText", () => {
  it("returns bare JSON objects unchanged", () => {
    expect(extractJsonObjectText('{"a":1}')).toBe('{"a":1}');
  });

  it("strips markdown fences and surrounding prose", () => {
    expect(extractJsonObjectText('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(extractJsonObjectText('Here you go: {"a":1} Done.')).toBe('{"a":1}');
  });

  it("rejects replies without a JSON object", () => {
    expect(() => extractJsonObjectText("no object here")).toThrow(
      NO_JSON_OBJECT_PATTERN
    );
  });
});

describe("structuredJsonPrompt", () => {
  it("embeds the task prompt and the output schema", () => {
    const prompt = structuredJsonPrompt({
      outputSchema: { type: "object" },
      prompt: "Extract the facts.",
    });
    expect(prompt).toContain("Extract the facts.");
    expect(prompt).toContain('<output-schema>\n{"type":"object"}');
    expect(prompt).toContain("exactly one JSON object");
  });
});
