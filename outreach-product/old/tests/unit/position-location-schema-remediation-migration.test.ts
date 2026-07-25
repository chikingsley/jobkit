import { describe, expect, it } from "vitest";

import migration from "../../migrations/0067_requeue_falsely_promoted_position_analyses.sql?raw";

describe("position location schema remediation migration", () => {
  it("requeues records without a completed v3 extraction", () => {
    expect(migration).toContain("SET schema_version = 2");
    expect(migration).toContain(
      "task.prompt_version = 'job-position-analysis-v3'"
    );
    expect(migration).toContain(
      "task.source_task_id = job_position_analyses.job_id"
    );
    expect(migration).toContain(
      "task.source_hash = job_position_analyses.source_hash"
    );
    expect(migration).toContain("task.status = 'completed'");
  });
});
