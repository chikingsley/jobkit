import type {
  AnalysisRunResult,
  AnalysisTask,
  ModelConfiguration,
} from "./contracts";

export function summarizeAnalysisRuns(
  results: AnalysisRunResult[],
  models: ModelConfiguration[],
  caseCount: number
) {
  return models.flatMap((configuration) =>
    (["content", "facts", "positions"] as AnalysisTask[]).map((task) => {
      const selected = results.filter(
        (result) => result.model === configuration.model && result.task === task
      );
      const successful = selected.filter((result) => result.output);
      return {
        averageLatencyMs:
          selected.length === 0
            ? 0
            : Math.round(
                selected.reduce((sum, result) => sum + result.latencyMs, 0) /
                  selected.length
              ),
        cases: caseCount,
        evidencePasses: successful.filter((result) => result.supportedEvidence)
          .length,
        model: configuration.model,
        schemaPasses: successful.length,
        task,
      };
    })
  );
}
