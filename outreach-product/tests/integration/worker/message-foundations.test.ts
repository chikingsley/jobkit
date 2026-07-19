import { describe, expect, it } from "vitest";
import {
  advertisedPositionQuestion,
  applicationMessagePolicyFor,
  messageTemplateKeyFor,
} from "../../../worker/ai/application-message-policy";
import { openingFor } from "../../../worker/ai/application-messages";

describe("message foundation template selection", () => {
  it.each([
    ["advertised_position", "general", "long", "advertised_long_general"],
    ["advertised_position", "young", "long", "advertised_long_young"],
    ["advertised_position", "general", "short", "advertised_short"],
    ["school_outreach", "general", "long", "school_outreach_long"],
    ["school_outreach", "general", "short", "school_outreach_short"],
    ["multi_position", "young", "short", "multi_position"],
  ] as const)("selects %s/%s/%s as %s", (route, audience, length, expected) => {
    expect(messageTemplateKeyFor(route, { audience, length })).toBe(expected);
  });

  it("uses the active user's stored template verbatim", () => {
    const approvedTemplate = "Hello,\n\n[profile-backed opening]";
    expect(
      applicationMessagePolicyFor(
        "advertised_position",
        approvedTemplate,
        new Date("2026-07-15T12:00:00Z"),
        "UTC"
      )
    ).toMatchObject({ approvedTemplate });
  });

  it("calculates the closing question from the candidate's calendar", () => {
    expect(
      advertisedPositionQuestion(
        new Date("2026-07-15T18:00:00Z"),
        "America/Los_Angeles"
      )
    ).toBe("Would you be free to speak about the role this week?");
    expect(
      advertisedPositionQuestion(
        new Date("2026-07-17T18:00:00Z"),
        "America/Los_Angeles"
      )
    ).toBe(
      "Would you be free to speak about the role next week, the week of July 20?"
    );
  });

  it("uses a structured contact's honorific and last name", () => {
    expect(openingFor("Mr. Corey Yang")).toBe("Hello Mr. Yang,");
    expect(openingFor("")).toBe("Hello,");
  });
});
