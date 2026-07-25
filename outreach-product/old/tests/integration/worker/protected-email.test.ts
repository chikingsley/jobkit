import { describe, expect, it } from "vitest";
import {
  cloudflareEmailsFromHtml,
  decodeCloudflareEmail,
  protectedEmailParts,
} from "../../../src/features/jobs/protected-email";

describe("protected source emails", () => {
  it("decodes Cloudflare data-cfemail values and rejects malformed input", () => {
    expect(decodeCloudflareEmail("6d090c1b082d08150c001d01084319081e19")).toBe(
      "dave@example.test"
    );
    expect(decodeCloudflareEmail("not-hex")).toBeNull();
  });

  it("extracts unique decoded addresses from source HTML", () => {
    const encoded = "6d090c1b082d08150c001d01084319081e19";
    expect(
      cloudflareEmailsFromHtml(
        `<span data-cfemail="${encoded}">[email&#160;protected]</span>`
      )
    ).toEqual(["dave@example.test"]);
  });

  it("recognizes ordinary, nonbreaking-space, and entity placeholders", () => {
    expect(
      protectedEmailParts(
        "Email [email protected], backup [email protected], or [email&#160;protected]."
      ).filter((part) => part.kind === "placeholder")
    ).toHaveLength(3);
  });
});
