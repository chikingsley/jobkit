import { describe, expect, test } from "bun:test";
import { parse } from "node-html-parser";
import { renderToStaticMarkup } from "react-dom/server";
import { CampaignDispatchCard } from "../../src/features/campaigns/dispatch-card";
import type {
  CampaignDispatch,
  CampaignTarget,
} from "../../src/features/campaigns/types";

describe("campaign dispatch review card", () => {
  test("uses target context instead of a numbered message or side stripe", () => {
    const html = render(
      dispatch("single", [target("school-1", "Arkon Institute")])
    );
    const root = parse(html);

    expect(root.textContent).toContain("Arkon Institute");
    expect(root.textContent).toContain("Cold outreach · Email · Tajikistan");
    expect(root.textContent).not.toContain("Message 1");
    expect(root.querySelector(".border-l-2")).toBeNull();
  });

  test("represents one ANESL email as a bundle with its selected positions", () => {
    const html = render(
      dispatch("anesl_bundle", [
        target("position-1", "University English Lecturer", "advertised"),
        target("position-2", "Adult ESL Instructor", "advertised"),
      ])
    );
    const root = parse(html);

    expect(root.textContent).toContain("ANESL application bundle");
    expect(root.textContent).toContain(
      "2 selected positions · Email · Tajikistan"
    );
    expect(root.textContent).toContain("Selected positions (2)");
    expect(root.textContent).toContain("University English Lecturer");
    expect(root.textContent).toContain("Adult ESL Instructor");
  });
});

function render(value: CampaignDispatch) {
  return renderToStaticMarkup(
    <CampaignDispatchCard
      campaignId="campaign-1"
      dispatch={value}
      onApproveFailed={() => undefined}
      onApproveStart={() => undefined}
      onChanged={async () => undefined}
      request={async () => new Response()}
    />
  );
}

function dispatch(
  routeStrategy: CampaignDispatch["routeStrategy"],
  targets: CampaignTarget[]
): CampaignDispatch {
  return {
    channel: "email",
    id: `dispatch-${routeStrategy}`,
    message: {
      changeSummary: "",
      createdAt: "2026-07-23T00:00:00Z",
      dispatchId: `dispatch-${routeStrategy}`,
      id: `message-${routeStrategy}`,
      message: "Hello,\n\nI am interested in teaching opportunities.",
      previousMessage: "",
      status: "draft",
      version: 1,
    },
    recipient: "jobs@example.test",
    routeStrategy,
    status: "review",
    subject: "Teaching opportunities",
    targets,
    updatedAt: "2026-07-23T00:00:00Z",
  };
}

function target(
  id: string,
  label: string,
  sourceKind: CampaignTarget["sourceKind"] = "school"
): CampaignTarget {
  return {
    channel: "email",
    countryCode: "TJ",
    description: "",
    destination: "jobs@example.test",
    holdReason: "",
    id,
    label,
    matchLabel: "Strong match",
    matchScore: 90,
    routeStrategy: "single",
    sourceKind,
    sourceUrl: "https://example.test",
    status: "ready",
    updatedAt: "2026-07-23T00:00:00Z",
  };
}
