import { describe, expect, it } from "bun:test";
import { migrationTriggerViolations } from "../../cli/quality/check-migration-triggers";

const SPLITTER_SAFE_TRIGGER = `CREATE TRIGGER trg_example_guard
BEFORE UPDATE ON example
BEGIN
  SELECT RAISE(ABORT,'example is immutable')
   WHERE OLD.status='sealed' AND NEW.status IS NOT OLD.status;
END;`;

const CASE_TRIGGER = `CREATE TRIGGER trg_example_guard
BEFORE UPDATE ON example
BEGIN
  SELECT CASE WHEN OLD.status='sealed'
  THEN RAISE(ABORT,'example is immutable') END;
END;`;

describe("migration trigger splitter guard", () => {
  it("flags CASE inside a new trigger body", () => {
    expect(
      migrationTriggerViolations("0999_example.sql", CASE_TRIGGER)
    ).toEqual([{ migration: "0999_example.sql", trigger: 1 }]);
  });

  it("accepts the splitter-safe RAISE WHERE form", () => {
    expect(
      migrationTriggerViolations("0999_example.sql", SPLITTER_SAFE_TRIGGER)
    ).toEqual([]);
  });

  it("ignores CASE outside trigger bodies", () => {
    const sql = `UPDATE example
      SET label=CASE WHEN status='sealed' THEN 'done' ELSE 'open' END;
    ${SPLITTER_SAFE_TRIGGER}`;
    expect(migrationTriggerViolations("0999_example.sql", sql)).toEqual([]);
  });

  it("ignores CASE inside comments and string literals", () => {
    const sql = `CREATE TRIGGER trg_example_guard
BEFORE UPDATE ON example
BEGIN
  -- a CASE in a comment is fine
  SELECT RAISE(ABORT,'do not use case here') WHERE NEW.id IS NOT OLD.id;
END;`;
    expect(migrationTriggerViolations("0999_example.sql", sql)).toEqual([]);
  });

  it("reports the ordinal of each offending trigger", () => {
    const sql = `${SPLITTER_SAFE_TRIGGER}\n${CASE_TRIGGER}`;
    expect(migrationTriggerViolations("0999_example.sql", sql)).toEqual([
      { migration: "0999_example.sql", trigger: 2 },
    ]);
  });

  it("grandfathers migrations that shipped before the guard", () => {
    expect(
      migrationTriggerViolations(
        "0049_public_projection_runs.sql",
        CASE_TRIGGER
      )
    ).toEqual([]);
  });
});
