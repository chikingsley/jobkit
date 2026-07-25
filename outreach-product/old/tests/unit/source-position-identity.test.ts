import { describe, expect, test } from "bun:test";
import type {
  JobPositionAnalysis,
  JobPositionVariant,
} from "../../src/features/jobs/position-variants";
import {
  extractedPositionDiscriminator,
  normalizeIdentityText,
  SourcePositionIdentityError,
  sourcePositionIdentities,
} from "../../src/features/public/source-position-identity";

describe("stable source-position identity", () => {
  test("keeps a direct listing stable through title changes", async () => {
    const first = await sourcePositionIdentities(
      "listing-1",
      analysis("direct", [position("English teacher")])
    );
    const renamed = await sourcePositionIdentities(
      "listing-1",
      analysis("direct", [position("Senior English teacher")])
    );

    expect(first).toHaveLength(1);
    expect(first[0]?.id).toBe(renamed[0]?.id);
    expect(first[0]?.positionKey).toBe("direct");
  });

  test("keeps multi-position identities stable when source order changes", async () => {
    const math = position("Math Teacher", "subject_specialist", [
      "Mathematics",
    ]);
    const english = position("English Teacher", "english_language", [
      "English",
    ]);
    const first = await sourcePositionIdentities(
      "listing-2",
      analysis("multi_position", [math, english])
    );
    const reordered = await sourcePositionIdentities(
      "listing-2",
      analysis("multi_position", [english, math])
    );

    expect(
      first
        .map(({ id }) => id)
        .toSorted((left, right) => left.localeCompare(right))
    ).toEqual(
      reordered
        .map(({ id }) => id)
        .toSorted((left, right) => left.localeCompare(right))
    );
    expect(
      first.every(({ positionKind }) => positionKind === "extracted")
    ).toBe(true);
  });

  test("normalizes Unicode, punctuation, case, and subject order", () => {
    expect(normalizeIdentityText("  ＭＡＴＨ—Teacher!! ")).toBe("math teacher");
    expect(
      extractedPositionDiscriminator(
        position("Math—Teacher", "subject_specialist", [
          "Physics",
          "MATHEMATICS",
          "physics",
        ])
      )
    ).toBe(
      JSON.stringify({
        roleFamily: "subject_specialist",
        subjects: ["mathematics", "physics"],
        title: "math teacher",
      })
    );
  });

  test("restores the same identity when a role returns from A to B to A", async () => {
    const roleA = analysis("multi_position", [
      position("Physics Teacher", "subject_specialist", ["Physics"]),
    ]);
    const roleB = analysis("multi_position", [
      position("Chemistry Teacher", "subject_specialist", ["Chemistry"]),
    ]);

    const firstA = await sourcePositionIdentities("listing-3", roleA);
    const middleB = await sourcePositionIdentities("listing-3", roleB);
    const finalA = await sourcePositionIdentities("listing-3", roleA);

    expect(firstA[0]?.id).toBe(finalA[0]?.id);
    expect(firstA[0]?.id).not.toBe(middleB[0]?.id);
  });

  test("blocks two extracted positions with the same discriminator", async () => {
    const duplicate = position("English teacher", "english_language", [
      "English",
    ]);
    const promise = sourcePositionIdentities(
      "listing-4",
      analysis("multi_position", [duplicate, duplicate])
    );

    await expect(promise).rejects.toBeInstanceOf(SourcePositionIdentityError);
    await expect(promise).rejects.toMatchObject({
      code: "source_position_key_collision",
    });
  });
});

function analysis(
  scope: JobPositionAnalysis["scope"],
  positions: JobPositionVariant[]
): JobPositionAnalysis {
  return { positions, reviewNotes: [], scope };
}

function position(
  title: string,
  roleFamily: JobPositionVariant["roleFamily"] = "english_language",
  subjects: string[] = []
): JobPositionVariant {
  return {
    audiences: [],
    certainty: "explicit",
    compensationEvidence: [],
    employmentTypes: [],
    evidence: [title],
    locations: [],
    requirements: [],
    roleFamily,
    subjects: subjects.map((value) => ({ evidence: value, value })),
    title,
  };
}
