import { describe, expect, test } from "bun:test";
import { authModeFromSearch } from "../../src/features/auth/auth-page";
import { jobsSearchSchema } from "../../src/features/workspace/search";

describe("public auth entry search contract", () => {
  test("accepts the signup flag alongside a preserved public job intent", () => {
    const parsed = jobsSearchSchema.parse({
      publicJob: "pj_12345",
      signup: "true",
    });

    expect(parsed.signup).toBe(true);
    expect(parsed.publicJob).toBe("pj_12345");
  });

  test("normalizes signup flag variants and drops junk values", () => {
    expect(jobsSearchSchema.parse({ signup: "1" }).signup).toBe(true);
    expect(jobsSearchSchema.parse({ signup: true }).signup).toBe(true);
    expect(jobsSearchSchema.parse({ signup: "false" }).signup).toBe(false);
    expect(jobsSearchSchema.parse({ signup: "" }).signup).toBeUndefined();
    expect(jobsSearchSchema.parse({ signup: "junk" }).signup).toBeUndefined();
    expect(jobsSearchSchema.parse({}).signup).toBeUndefined();
  });

  test("selects the auth page mode from the signup flag", () => {
    expect(authModeFromSearch(true)).toBe("sign-up");
    expect(authModeFromSearch(false)).toBe("sign-in");
    expect(authModeFromSearch(undefined)).toBe("sign-in");
  });
});
