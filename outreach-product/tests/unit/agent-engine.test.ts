import { describe, expect, it } from "bun:test";
import {
  DEFAULT_OPENCODE_MODEL,
  resolveAgentEngine,
  resolveEngineModel,
  resolveLocalModel,
  resolveOpencodeModel,
} from "../../cli/lib/agent-engine";
import { DEFAULT_LOCAL_LLM_MODEL } from "../../cli/lib/local-agent";
import { finalAssistantText } from "../../cli/lib/opencode-agent";
import {
  extractJsonObjectText,
  structuredJsonPrompt,
} from "../../cli/lib/structured-json";

const ENGINE_ERROR_PATTERN = /JOBKIT_AGENT_ENGINE/u;
const VALID_JSON_PATTERN = /valid JSON/u;
const NON_EMPTY_MODEL_PATTERN = /non-empty model/u;
const NO_JSON_OBJECT_PATTERN = /no JSON object/u;

describe("resolveAgentEngine", () => {
  it("defaults to codex when the engine is unset", () => {
    expect(resolveAgentEngine({})).toBe("codex");
  });

  it("selects opencode case-insensitively", () => {
    expect(resolveAgentEngine({ JOBKIT_AGENT_ENGINE: " OpenCode " })).toBe(
      "opencode"
    );
  });

  it("selects the local engine", () => {
    expect(resolveAgentEngine({ JOBKIT_AGENT_ENGINE: " Local " })).toBe(
      "local"
    );
  });

  it("rejects unknown engines", () => {
    expect(() => resolveAgentEngine({ JOBKIT_AGENT_ENGINE: "claude" })).toThrow(
      ENGINE_ERROR_PATTERN
    );
  });
});

describe("resolveOpencodeModel", () => {
  it("maps job analysis task types to the cheap extraction model", () => {
    expect(resolveOpencodeModel("job.match_facts", {})).toBe(
      "opencode-go/deepseek-v4-flash"
    );
    expect(resolveOpencodeModel("job.content_analysis", {})).toBe(
      "opencode-go/deepseek-v4-flash"
    );
    expect(resolveOpencodeModel("job.position_analysis", {})).toBe(
      "opencode-go/deepseek-v4-flash"
    );
  });

  it("maps drafting and vision task types to the stronger model", () => {
    expect(resolveOpencodeModel("application.message", {})).toBe(
      "opencode-go/glm-5.2"
    );
    expect(resolveOpencodeModel("profile.import", {})).toBe(
      "opencode-go/glm-5.2"
    );
  });

  it("routes country sweep task types through the sweep model", () => {
    expect(resolveOpencodeModel("country_sweep.organizations", {})).toBe(
      "opencode-go/glm-5.2"
    );
  });

  it("falls back to the default model for unknown task types", () => {
    expect(resolveOpencodeModel("mystery.task", {})).toBe(
      DEFAULT_OPENCODE_MODEL
    );
    expect(
      resolveOpencodeModel("mystery.task", {
        JOBKIT_OPENCODE_DEFAULT_MODEL: "opencode/mimo-v2.5-free",
      })
    ).toBe("opencode/mimo-v2.5-free");
  });

  it("honors JSON overrides including the country sweep wildcard", () => {
    const env = {
      JOBKIT_OPENCODE_MODELS: JSON.stringify({
        "country_sweep.*": "opencode-go/qwen3.7-plus",
        "job.match_facts": "opencode/ling-3.0-flash-free",
      }),
    };
    expect(resolveOpencodeModel("job.match_facts", env)).toBe(
      "opencode/ling-3.0-flash-free"
    );
    expect(resolveOpencodeModel("country_sweep.contacts", env)).toBe(
      "opencode-go/qwen3.7-plus"
    );
  });

  it("rejects malformed override JSON", () => {
    expect(() =>
      resolveOpencodeModel("job.match_facts", {
        JOBKIT_OPENCODE_MODELS: "not-json",
      })
    ).toThrow(VALID_JSON_PATTERN);
    expect(() =>
      resolveOpencodeModel("job.match_facts", {
        JOBKIT_OPENCODE_MODELS: '{"job.match_facts":""}',
      })
    ).toThrow(NON_EMPTY_MODEL_PATTERN);
  });
});

describe("resolveLocalModel", () => {
  it("serves every task type from the single local model by default", () => {
    expect(resolveLocalModel("job.match_facts", {})).toBe(
      DEFAULT_LOCAL_LLM_MODEL
    );
    expect(resolveLocalModel("application.message", {})).toBe(
      DEFAULT_LOCAL_LLM_MODEL
    );
  });

  it("honors the default model environment variable", () => {
    expect(
      resolveLocalModel("job.match_facts", {
        JOBKIT_LOCAL_LLM_MODEL: " qwen4-32b ",
      })
    ).toBe("qwen4-32b");
  });

  it("honors JSON overrides including the country sweep wildcard", () => {
    const env = {
      JOBKIT_LOCAL_LLM_MODELS: JSON.stringify({
        "country_sweep.*": "qwen4-32b",
        "job.match_facts": "qwen35-9b-instruct",
      }),
    };
    expect(resolveLocalModel("job.match_facts", env)).toBe(
      "qwen35-9b-instruct"
    );
    expect(resolveLocalModel("country_sweep.contacts", env)).toBe("qwen4-32b");
    expect(resolveLocalModel("profile.import", env)).toBe(
      DEFAULT_LOCAL_LLM_MODEL
    );
  });

  it("rejects malformed override JSON", () => {
    expect(() =>
      resolveLocalModel("job.match_facts", {
        JOBKIT_LOCAL_LLM_MODELS: "not-json",
      })
    ).toThrow(VALID_JSON_PATTERN);
    expect(() =>
      resolveLocalModel("job.match_facts", {
        JOBKIT_LOCAL_LLM_MODELS: '{"job.match_facts":""}',
      })
    ).toThrow(NON_EMPTY_MODEL_PATTERN);
  });
});

describe("resolveEngineModel", () => {
  it("keeps the envelope model for codex", () => {
    expect(
      resolveEngineModel("codex", "job.match_facts", "gpt-5.6-luna", {})
    ).toBe("gpt-5.6-luna");
  });

  it("replaces the envelope model for opencode", () => {
    expect(
      resolveEngineModel("opencode", "job.match_facts", "gpt-5.6-luna", {})
    ).toBe("opencode-go/deepseek-v4-flash");
  });

  it("replaces the envelope model for the local engine", () => {
    expect(
      resolveEngineModel("local", "job.match_facts", "gpt-5.6-luna", {})
    ).toBe(DEFAULT_LOCAL_LLM_MODEL);
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
