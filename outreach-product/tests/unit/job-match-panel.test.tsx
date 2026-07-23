import { describe, expect, test } from "bun:test";
import { parse } from "node-html-parser";
import { renderToStaticMarkup } from "react-dom/server";
import { MatchPanel } from "../../src/features/jobs/match";
import type { JobMatch } from "../../src/profile-types";

describe("job match requirement controls", () => {
  test("keeps requirement rows uniform and replaces compact answers with status", () => {
    const html = renderToStaticMarkup(
      <MatchPanel
        busyClaimKey=""
        match={match}
        onQualificationClaim={async () => undefined}
        summary="Two confirmed requirements and one answer needed."
      />
    );
    const root = parse(html);
    const rows = root.querySelectorAll("[data-match-requirement]");
    const passportRow = rows.find((row) =>
      row.textContent.includes("Valid passport ID page")
    );
    const visaRow = rows.find((row) =>
      row.textContent.includes("Valid work visa")
    );

    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.classNames.includes("min-h-11"))).toBe(true);
    expect(passportRow?.querySelector('[role="radiogroup"]')).not.toBeNull();
    expect(passportRow?.textContent).toContain("YesNoValid passport ID page");
    expect(passportRow?.textContent).not.toContain("Choose once");
    expect(visaRow?.querySelector('[role="radiogroup"]')).toBeNull();
    expect(
      visaRow?.querySelector(
        'button[aria-label="Change saved answer for Valid work visa"]'
      )
    ).not.toBeNull();
  });
});

const match: JobMatch = {
  criteria: [
    {
      claimKey: '{"kind":"document","values":["passport"]}',
      claimKind: "document",
      importance: "required",
      label: "Valid passport ID page",
      state: "unknown",
    },
    {
      claimKey: '{"kind":"degree","minimumDegreeLevel":"bachelor"}',
      claimKind: "degree",
      importance: "required",
      label: "Bachelor degree",
      state: "match",
    },
    {
      claimAnswer: "no",
      claimKey: '{"kind":"workAuthorization","values":["China"]}',
      claimKind: "workAuthorization",
      importance: "required",
      label: "Valid work visa",
      state: "conflict",
    },
  ],
  label: "Needs verification",
  score: 70,
  tone: "neutral",
};
