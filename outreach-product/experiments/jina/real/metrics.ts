import type { RealCapabilityCorpus, TimedResult } from "./contracts";
import { domainMatches, normalizeText, tokenSet } from "./text";

interface JinaEvaluation {
  deduplication: Array<{
    dimensions: number;
    latencyMs: number;
    model: string;
    repeat: number;
    results: Array<{ id: string; nearestId: string }>;
  }>;
  reader: TimedResult<{ text: string }>[];
  reranking: TimedResult<{ orderedIds: string[] }>[];
  search: TimedResult<{ text: string; urls: string[] }>[];
}

interface CodexEvaluation {
  deduplication: TimedResult<{ nearestId: string }>[];
  reranking: TimedResult<{ orderedIds: string[] }>[];
  search: TimedResult<{ sources: Array<{ title: string; url: string }> }>[];
}

export function summarizeJinaEvaluation(
  corpus: RealCapabilityCorpus,
  result: JinaEvaluation
) {
  const readerCases = new Map(corpus.reader.map((item) => [item.id, item]));
  const reader = result.reader.map((item) => {
    const testCase = readerCases.get(item.id);
    const output = item.output?.text ?? "";
    const normalizedOutput = normalizeText(output);
    const matchedMarkers =
      testCase?.markers.filter((marker) =>
        normalizedOutput.includes(normalizeText(marker.value))
      ).length ?? 0;
    const markerCount = testCase?.markers.length ?? 0;
    const expectedTokens = tokenSet(testCase?.description ?? "");
    const outputTokens = tokenSet(output);
    const descriptionTokensFound = [...expectedTokens].filter((token) =>
      outputTokens.has(token)
    ).length;
    return {
      descriptionTokenRecall:
        expectedTokens.size > 0
          ? descriptionTokensFound / expectedTokens.size
          : 0,
      error: item.error,
      id: item.id,
      latencyMs: item.latencyMs,
      markerCount,
      markerRecall: markerCount > 0 ? matchedMarkers / markerCount : 0,
      matchedMarkers,
    };
  });
  const searchCases = new Map(corpus.search.map((item) => [item.id, item]));
  const search = result.search.map((item) => {
    const expectedDomain = searchCases.get(item.id)?.expectedDomain ?? "";
    const rank =
      item.output?.urls.findIndex((url) =>
        domainMatches(url, expectedDomain)
      ) ?? -1;
    return {
      error: item.error,
      expectedDomain,
      id: item.id,
      latencyMs: item.latencyMs,
      rank: rank < 0 ? null : rank + 1,
    };
  });
  const rerankingCases = new Map(
    corpus.reranking.map((item) => [item.id, item])
  );
  const reranking = result.reranking.map((item) => ({
    error: item.error,
    expectedId: rerankingCases.get(item.id)?.expectedId ?? "",
    id: item.id,
    latencyMs: item.latencyMs,
    rank: rankOf(
      item.output?.orderedIds ?? [],
      rerankingCases.get(item.id)?.expectedId ?? ""
    ),
  }));
  const deduplicationCases = new Map(
    corpus.deduplication.map((item) => [item.id, item])
  );
  const deduplication = result.deduplication.map((run) => {
    const correct = run.results.filter(
      (item) => item.nearestId === deduplicationCases.get(item.id)?.expectedId
    ).length;
    return {
      accuracy: run.results.length > 0 ? correct / run.results.length : 0,
      correct,
      dimensions: run.dimensions,
      latencyMs: run.latencyMs,
      model: run.model,
      repeat: run.repeat,
      total: run.results.length,
    };
  });
  return {
    deduplication,
    reader: {
      cases: reader,
      completed: reader.filter((item) => !item.error).length,
      meanDescriptionTokenRecall: mean(
        reader
          .filter((item) => !item.error)
          .map((item) => item.descriptionTokenRecall)
      ),
      meanMarkerRecall: mean(
        reader.filter((item) => !item.error).map((item) => item.markerRecall)
      ),
      medianLatencyMs: median(
        reader.filter((item) => !item.error).map((item) => item.latencyMs)
      ),
      total: reader.length,
    },
    reranking: {
      cases: reranking,
      meanReciprocalRank: mean(
        reranking.map((item) => (item.rank ? 1 / item.rank : 0))
      ),
      medianLatencyMs: median(
        reranking.filter((item) => !item.error).map((item) => item.latencyMs)
      ),
      top1: reranking.filter((item) => item.rank === 1).length,
      top3: reranking.filter((item) => item.rank !== null && item.rank <= 3)
        .length,
      total: reranking.length,
    },
    search: {
      cases: search,
      meanReciprocalRank: mean(
        search.map((item) => (item.rank ? 1 / item.rank : 0))
      ),
      medianLatencyMs: median(
        search.filter((item) => !item.error).map((item) => item.latencyMs)
      ),
      targetFound: search.filter((item) => item.rank !== null).length,
      top3: search.filter((item) => item.rank !== null && item.rank <= 3)
        .length,
      total: search.length,
    },
  };
}

export function summarizeCodexEvaluation(
  corpus: RealCapabilityCorpus,
  result: CodexEvaluation
) {
  const searchCases = new Map(corpus.search.map((item) => [item.id, item]));
  const search = result.search.map((item) => {
    const expectedDomain = searchCases.get(item.id)?.expectedDomain ?? "";
    const rank =
      item.output?.sources.findIndex((source) =>
        domainMatches(source.url, expectedDomain)
      ) ?? -1;
    return {
      error: item.error,
      expectedDomain,
      id: item.id,
      latencyMs: item.latencyMs,
      rank: rank < 0 ? null : rank + 1,
    };
  });
  const rankingCases = new Map(corpus.reranking.map((item) => [item.id, item]));
  const reranking = result.reranking.map((item) => ({
    error: item.error,
    id: item.id,
    latencyMs: item.latencyMs,
    rank: rankOf(
      item.output?.orderedIds ?? [],
      rankingCases.get(item.id)?.expectedId ?? ""
    ),
  }));
  const deduplicationCases = new Map(
    corpus.deduplication.map((item) => [item.id, item])
  );
  const deduplication = result.deduplication.map((item) => ({
    correct:
      item.output?.nearestId === deduplicationCases.get(item.id)?.expectedId,
    error: item.error,
    id: item.id,
    latencyMs: item.latencyMs,
  }));
  return {
    deduplication: {
      correct: deduplication.filter((item) => item.correct).length,
      medianLatencyMs: median(
        deduplication
          .filter((item) => !item.error)
          .map((item) => item.latencyMs)
      ),
      total: deduplication.length,
    },
    reranking: {
      meanReciprocalRank: mean(
        reranking.map((item) => (item.rank ? 1 / item.rank : 0))
      ),
      medianLatencyMs: median(
        reranking.filter((item) => !item.error).map((item) => item.latencyMs)
      ),
      top1: reranking.filter((item) => item.rank === 1).length,
      top3: reranking.filter((item) => item.rank !== null && item.rank <= 3)
        .length,
      total: reranking.length,
    },
    search: {
      meanReciprocalRank: mean(
        search.map((item) => (item.rank ? 1 / item.rank : 0))
      ),
      medianLatencyMs: median(
        search.filter((item) => !item.error).map((item) => item.latencyMs)
      ),
      targetFound: search.filter((item) => item.rank !== null).length,
      top3: search.filter((item) => item.rank !== null && item.rank <= 3)
        .length,
      total: search.length,
    },
  };
}

function rankOf(values: string[], expected: string) {
  const index = values.indexOf(expected);
  return index < 0 ? null : index + 1;
}

function mean(values: number[]) {
  return values.length
    ? values.reduce((total, value) => total + value, 0) / values.length
    : 0;
}

function median(values: number[]) {
  if (values.length === 0) {
    return 0;
  }
  const sorted = values.toSorted((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? 0);
}
