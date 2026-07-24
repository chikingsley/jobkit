import { describe, expect, it } from "bun:test";
import {
  DEFAULT_LOCAL_LLM_BASE_URL,
  DEFAULT_LOCAL_LLM_KEY_FILE,
  DEFAULT_LOCAL_LLM_MAX_TOKENS,
  DEFAULT_LOCAL_LLM_MODEL,
  extractLocalCompletion,
  resolveLocalAgentConfig,
  resolveLocalDefaultModel,
  runLocalStructuredAgent,
} from "../../cli/lib/local-agent";

const POSITIVE_INTEGER_PATTERN = /positive integer/u;
const NO_CHOICES_PATTERN = /no choices/u;
const NOT_JSON_OBJECT_PATTERN = /not a JSON object/u;
const MAX_TOKENS_PATTERN = /max_tokens/u;
const NO_FINAL_CONTENT_PATTERN = /no final content/u;
const ARTIFACTS_UNSUPPORTED_PATTERN = /does not support image artifacts/u;
const THINKING_FLAG_PATTERN = /JOBKIT_LOCAL_LLM_THINKING/u;

describe("resolveLocalAgentConfig", () => {
  it("applies the documented defaults", () => {
    expect(resolveLocalAgentConfig({})).toEqual({
      baseUrl: DEFAULT_LOCAL_LLM_BASE_URL,
      keyFile: DEFAULT_LOCAL_LLM_KEY_FILE,
      maxTokens: DEFAULT_LOCAL_LLM_MAX_TOKENS,
      thinking: false,
    });
  });

  it("honors environment overrides and trims trailing slashes", () => {
    expect(
      resolveLocalAgentConfig({
        JOBKIT_LOCAL_LLM_BASE_URL: " http://10.0.0.5:9000/v1/ ",
        JOBKIT_LOCAL_LLM_KEY_FILE: "/run/secrets/llm-key",
        JOBKIT_LOCAL_LLM_MAX_TOKENS: "8192",
        JOBKIT_LOCAL_LLM_THINKING: "true",
      })
    ).toEqual({
      baseUrl: "http://10.0.0.5:9000/v1",
      keyFile: "/run/secrets/llm-key",
      maxTokens: 8192,
      thinking: true,
    });
  });

  it("rejects non-positive max token limits", () => {
    expect(() =>
      resolveLocalAgentConfig({ JOBKIT_LOCAL_LLM_MAX_TOKENS: "0" })
    ).toThrow(POSITIVE_INTEGER_PATTERN);
    expect(() =>
      resolveLocalAgentConfig({ JOBKIT_LOCAL_LLM_MAX_TOKENS: "many" })
    ).toThrow(POSITIVE_INTEGER_PATTERN);
  });

  it("rejects unrecognized thinking flags", () => {
    expect(() =>
      resolveLocalAgentConfig({ JOBKIT_LOCAL_LLM_THINKING: "yes" })
    ).toThrow(THINKING_FLAG_PATTERN);
  });
});

describe("resolveLocalDefaultModel", () => {
  it("falls back to the served model name", () => {
    expect(resolveLocalDefaultModel({})).toBe(DEFAULT_LOCAL_LLM_MODEL);
  });

  it("prefers the environment override", () => {
    expect(
      resolveLocalDefaultModel({ JOBKIT_LOCAL_LLM_MODEL: " qwen4-32b " })
    ).toBe("qwen4-32b");
  });
});

describe("extractLocalCompletion", () => {
  it("returns the final content and strips reasoning_content", () => {
    const completion = extractLocalCompletion({
      choices: [
        {
          finish_reason: "stop",
          message: {
            content: ' {"answer":true} ',
            reasoning_content: 'step one, step two, {"answer":false}',
            role: "assistant",
          },
        },
      ],
      usage: { completion_tokens: 20, prompt_tokens: 100, total_tokens: 120 },
    });
    expect(completion.content).toBe('{"answer":true}');
    expect(completion.content).not.toContain("step one");
    expect(completion.usage).toEqual({
      completionTokens: 20,
      promptTokens: 100,
      totalTokens: 120,
    });
  });

  it("returns null usage when the server omits token counts", () => {
    const completion = extractLocalCompletion({
      choices: [{ finish_reason: "stop", message: { content: "{}" } }],
    });
    expect(completion.usage).toBeNull();
  });

  it("classifies max_tokens truncation distinctly", () => {
    expect(() =>
      extractLocalCompletion({
        choices: [
          {
            finish_reason: "length",
            message: { content: "", reasoning_content: "endless thinking" },
          },
        ],
      })
    ).toThrow(MAX_TOKENS_PATTERN);
  });

  it("reports missing content for other empty completions", () => {
    expect(() =>
      extractLocalCompletion({
        choices: [{ finish_reason: "stop", message: { content: "" } }],
      })
    ).toThrow(NO_FINAL_CONTENT_PATTERN);
  });

  it("rejects malformed payloads", () => {
    expect(() => extractLocalCompletion("nope")).toThrow(
      NOT_JSON_OBJECT_PATTERN
    );
    expect(() => extractLocalCompletion({ choices: [] })).toThrow(
      NO_CHOICES_PATTERN
    );
  });
});

describe("runLocalStructuredAgent", () => {
  it("fails image artifact tasks with an engine-unsupported error", () => {
    expect(
      runLocalStructuredAgent({
        artifacts: [
          {
            bytes: new Uint8Array([1]),
            contentType: "image/png",
            filename: "resume.png",
          },
        ],
        effort: "medium",
        model: DEFAULT_LOCAL_LLM_MODEL,
        outputSchema: { type: "object" },
        prompt: "Describe the image.",
        timeoutMs: 1000,
        webSearch: "disabled",
      })
    ).rejects.toThrow(ARTIFACTS_UNSUPPORTED_PATTERN);
  });
});
