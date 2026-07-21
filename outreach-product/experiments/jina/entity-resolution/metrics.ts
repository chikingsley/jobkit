import type { EntityLinkCorpus } from "./contracts";
import { resolveByStableIdentity } from "./resolution";

interface RetrievalResult {
  id: string;
  nearestId: string;
  scores: Array<{ id: string; score: number }>;
}

export function summarizeEntityRetrieval(
  corpus: EntityLinkCorpus,
  results: RetrievalResult[]
) {
  const cases = new Map(
    corpus.cases.map((testCase) => [testCase.id, testCase])
  );
  const measured = results.map((result) => {
    const testCase = cases.get(result.id);
    if (!testCase) {
      throw new Error(`Unknown entity-link result ${result.id}`);
    }
    const expectedRank = testCase.expectedId
      ? result.scores.findIndex((score) => score.id === testCase.expectedId) + 1
      : null;
    return {
      expectedRank: expectedRank === 0 ? null : expectedRank,
      id: result.id,
      kind: testCase.kind,
      margin: (result.scores[0]?.score ?? -1) - (result.scores[1]?.score ?? -1),
      nearestId: result.nearestId,
      topScore: result.scores[0]?.score ?? -1,
    };
  });
  const matches = measured.filter((item) => item.kind === "match");
  const noMatches = measured.filter((item) => item.kind === "no_match");
  const threshold = bestThreshold(matches, noMatches);
  const stable = corpus.cases.map((testCase) => ({
    expectedId: testCase.expectedId,
    id: testCase.id,
    kind: testCase.kind,
    resolution: resolveByStableIdentity(testCase),
  }));
  const stableResolved = stable.filter((item) => item.resolution !== null);
  return {
    cases: measured,
    matches: matches.length,
    matchTop1: matches.filter((item) => item.expectedRank === 1).length,
    matchTop3: matches.filter(
      (item) => item.expectedRank !== null && item.expectedRank <= 3
    ).length,
    matchTop5: matches.filter(
      (item) => item.expectedRank !== null && item.expectedRank <= 5
    ).length,
    noMatches: noMatches.length,
    stableIdentity: {
      correct: stableResolved.filter(
        (item) => item.resolution?.candidateId === item.expectedId
      ).length,
      falseLinks: stableResolved.filter(
        (item) => item.resolution?.candidateId !== item.expectedId
      ).length,
      reasons: Object.fromEntries(
        [
          ...Map.groupBy(
            stableResolved,
            (item) => item.resolution?.reason ?? "unknown"
          ).entries(),
        ].map(([reason, items]) => [reason, items.length])
      ),
      resolved: stableResolved.length,
      unresolved: stable.length - stableResolved.length,
    },
    threshold,
  };
}

function bestThreshold(
  matches: Array<{ expectedRank: number | null; topScore: number }>,
  noMatches: Array<{ topScore: number }>
) {
  const thresholds = [
    -1,
    ...new Set([...matches, ...noMatches].map((item) => item.topScore)),
    1,
  ].toSorted((left, right) => left - right);
  return thresholds
    .map((threshold) => {
      const trueLinks = matches.filter(
        (item) => item.expectedRank === 1 && item.topScore >= threshold
      ).length;
      const rejectedNoMatches = noMatches.filter(
        (item) => item.topScore < threshold
      ).length;
      const matchRecall = matches.length > 0 ? trueLinks / matches.length : 0;
      const noMatchRecall =
        noMatches.length > 0 ? rejectedNoMatches / noMatches.length : 0;
      return {
        balancedAccuracy: (matchRecall + noMatchRecall) / 2,
        matchRecall,
        noMatchRecall,
        threshold,
      };
    })
    .toSorted(
      (left, right) =>
        right.balancedAccuracy - left.balancedAccuracy ||
        right.noMatchRecall - left.noMatchRecall ||
        right.threshold - left.threshold
    )[0];
}
