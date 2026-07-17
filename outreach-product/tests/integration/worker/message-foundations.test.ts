import { describe, expect, it } from "vitest";
import {
  applicationMessagePolicyFor,
  messageTemplateKeyFor,
} from "../../../worker/ai/application-message-policy";

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
      applicationMessagePolicyFor("advertised_position", approvedTemplate)
    ).toMatchObject({ approvedTemplate });
  });
});
