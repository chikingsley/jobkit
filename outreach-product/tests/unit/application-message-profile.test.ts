import { describe, expect, it } from "vitest";
import { defaultProfile } from "../../src/features/profile/schema";
import { messageProfile } from "../../worker/ai/application-messages";

describe("application message profile", () => {
  it("passes only approved work attribution and evidence to Codex", () => {
    const profile = messageProfile({
      ...defaultProfile,
      workExperience: [
        {
          current: false,
          employer: "Example Local School",
          endDate: "2024",
          highlights: ["Taught an unverified aggregate of 100 learners."],
          location: "Las Vegas, Nevada",
          messageAttribution: "describe",
          messageHighlights: [
            "Taught speaking and grammar classes for adult English learners.",
          ],
          startDate: "2022",
          title: "English Teacher",
        },
        {
          current: false,
          employer: "West Virginia University",
          endDate: "2016",
          highlights: ["Led review lectures for classes of 200+ students."],
          location: "Morgantown, West Virginia",
          messageAttribution: "name",
          messageHighlights: [
            "Led review lectures for classes of more than 200 students.",
          ],
          startDate: "2014",
          title: "Biology Teaching Assistant",
        },
      ],
    });

    expect(profile.workExperience).toEqual([
      {
        current: false,
        endDate: "2024",
        highlights: [
          "Taught speaking and grammar classes for adult English learners.",
        ],
        location: "Las Vegas, Nevada",
        organization: undefined,
        startDate: "2022",
        title: "English Teacher",
      },
      {
        current: false,
        endDate: "2016",
        highlights: [
          "Led review lectures for classes of more than 200 students.",
        ],
        location: "Morgantown, West Virginia",
        organization: "West Virginia University",
        startDate: "2014",
        title: "Biology Teaching Assistant",
      },
    ]);
    expect(JSON.stringify(profile)).not.toContain("Example Local School");
    expect(JSON.stringify(profile)).not.toContain("unverified aggregate");
  });
});
