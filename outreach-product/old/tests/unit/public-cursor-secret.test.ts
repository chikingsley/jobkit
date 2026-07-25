import { describe, expect, it } from "bun:test";
import { resolvePublicJobCursorSecret } from "../../src/features/public/cursor-secret";

describe("public cursor secret", () => {
  it("uses the configured secret in every environment", () => {
    expect(
      resolvePublicJobCursorSecret(
        { PUBLIC_JOB_CURSOR_SECRET: " configured-secret " },
        true
      )
    ).toBe("configured-secret");
    expect(
      resolvePublicJobCursorSecret(
        { PUBLIC_JOB_CURSOR_SECRET: "configured-secret" },
        false
      )
    ).toBe("configured-secret");
  });

  it("uses a stable local signer during development", () => {
    expect(resolvePublicJobCursorSecret({}, true)).toBe(
      resolvePublicJobCursorSecret({}, true)
    );
  });

  it("requires the deployed secret in production", () => {
    expect(() => resolvePublicJobCursorSecret({}, false)).toThrow(
      "PUBLIC_JOB_CURSOR_SECRET is unavailable"
    );
    expect(() =>
      resolvePublicJobCursorSecret({ PUBLIC_JOB_CURSOR_SECRET: "   " }, false)
    ).toThrow("PUBLIC_JOB_CURSOR_SECRET is unavailable");
  });
});
