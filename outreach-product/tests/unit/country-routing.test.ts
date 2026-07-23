import { describe, expect, it } from "bun:test";
import {
  countryCodeForSlug,
  countryDisplayName,
  countrySlugForCode,
} from "../../src/lib/country-routing";

describe("public country routing", () => {
  it("uses readable country names for canonical market paths", () => {
    expect(countryDisplayName("CN")).toBe("China");
    expect(countrySlugForCode("CN")).toBe("china");
    expect(countrySlugForCode("KR")).toBe("south-korea");
    expect(countryCodeForSlug("south-korea")).toBe("KR");
  });
});
