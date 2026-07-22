import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";

const fixedProductionSources = [
  "../../worker/repositories/public-projection-final-graph.ts",
  "../../worker/services/public-projection/final-graph.ts",
];
const finalWorkDirectory = new URL(
  "../../worker/repositories/public-projection-final-work/",
  import.meta.url
);
const finalGraphServiceDirectory = new URL(
  "../../worker/services/public-projection/final-graph/",
  import.meta.url
);
const productionSources = [
  ...fixedProductionSources,
  ...readdirSync(finalWorkDirectory)
    .filter((file) => file.endsWith(".ts"))
    .map(
      (file) => `../../worker/repositories/public-projection-final-work/${file}`
    ),
  ...readdirSync(finalGraphServiceDirectory)
    .filter((file) => file.endsWith(".ts"))
    .map(
      (file) => `../../worker/services/public-projection/final-graph/${file}`
    ),
].map((path) => ({
  path,
  source: readFileSync(new URL(path, import.meta.url), "utf8"),
}));

const rejectedShapes = [
  /SELECT\s+DISTINCT/iu,
  /GROUP\s+BY/iu,
  /WITH\s+raw_candidates/iu,
  /COMPONENT_ROOT_CANDIDATES/u,
  /WHEN\s+left_member_key\s*=\s*\?/iu,
  /left_member_key\s*=\s*\?\s+OR\s+right_member_key\s*=\s*\?/iu,
  /readStored(?:Resolution|Mapping|Canonical|Public|Work|Position)/u,
];

describe("final duplicate graph boundedness", () => {
  test("keeps rejected whole-slice and computed-neighbor query shapes out", () => {
    for (const { path, source } of productionSources) {
      for (const rejectedShape of rejectedShapes) {
        expect(
          rejectedShape.test(source),
          `${path} contains ${rejectedShape.source}`
        ).toBe(false);
      }
    }
  });

  test("keeps the normalized indexed page boundaries explicit", () => {
    const source = productionSources.map((entry) => entry.source).join("\n");
    for (const requiredBoundary of [
      "CANONICAL_LIVE_CANDIDATE_PAGE_SQL",
      "COMPONENT_LEFT_NEIGHBOR_PAGE_SQL",
      "COMPONENT_RIGHT_NEIGHBOR_PAGE_SQL",
      "COMPONENT_ROOT_CANDIDATE_PAGE_SQL",
      "COMPONENT_ROOT_WINNER_SQL",
      "LIVE_CANONICAL_MATCH_KEYSET_SQL",
      "LIVE_CANONICAL_SHADOW_PAGE_SQL",
    ]) {
      expect(source).toContain(requiredBoundary);
    }
  });
});
