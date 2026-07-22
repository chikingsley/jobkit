import { describe, expect, test } from "bun:test";
import { JobKitAgentApiError } from "../../cli/agent/client";
import {
  ArtifactDownloadError,
  classifyAgentTaskFailure,
} from "../../cli/agent/failure-classification";

describe("agent runner failure classification", () => {
  test("terminalizes completion validation and source conflicts", () => {
    expect(
      classifyAgentTaskFailure(
        new JobKitAgentApiError("Evidence rejected", 422, ["salary"]),
        "completion"
      )
    ).toBe("evidence_invalid");
    expect(
      classifyAgentTaskFailure(
        new JobKitAgentApiError("Schema rejected", 422),
        "completion"
      )
    ).toBe("schema_invalid");
    expect(
      classifyAgentTaskFailure(
        new JobKitAgentApiError("Source changed", 409),
        "completion"
      )
    ).toBe("source_changed");
  });

  test("keeps infrastructure failures retryable", () => {
    expect(
      classifyAgentTaskFailure(new Error("Codex timed out"), "execution")
    ).toBe("provider_unavailable");
    expect(
      classifyAgentTaskFailure(
        new ArtifactDownloadError("Artifact unavailable", 503),
        "artifact"
      )
    ).toBe("r2_unavailable");
    expect(
      classifyAgentTaskFailure(
        new JobKitAgentApiError("Worker unavailable", 503),
        "completion"
      )
    ).toBe("d1_unavailable");
  });

  test("treats artifact identity drift as a terminal source change", () => {
    expect(
      classifyAgentTaskFailure(
        new ArtifactDownloadError("Artifact missing", 404),
        "artifact"
      )
    ).toBe("source_changed");
    expect(
      classifyAgentTaskFailure(new Error("Artifact hash changed"), "artifact")
    ).toBe("source_changed");
  });
});
