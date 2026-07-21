export interface ClassificationObservation {
  actual: string;
  expected: string;
}

export function classificationMetrics(
  observations: ClassificationObservation[]
) {
  const labels = [
    ...new Set(
      observations.flatMap((observation) => [
        observation.actual,
        observation.expected,
      ])
    ),
  ].toSorted();
  const confusion = Object.fromEntries(
    labels.map((expected) => [
      expected,
      Object.fromEntries(
        labels.map((actual) => [
          actual,
          observations.filter(
            (observation) =>
              observation.expected === expected && observation.actual === actual
          ).length,
        ])
      ),
    ])
  );
  const perClass = Object.fromEntries(
    labels.map((label) => {
      const truePositive = observations.filter(
        (observation) =>
          observation.expected === label && observation.actual === label
      ).length;
      const predicted = observations.filter(
        (observation) => observation.actual === label
      ).length;
      const expected = observations.filter(
        (observation) => observation.expected === label
      ).length;
      const precision = ratio(truePositive, predicted);
      const recall = ratio(truePositive, expected);
      return [
        label,
        {
          f1: harmonicMean(precision, recall),
          precision,
          recall,
          support: expected,
        },
      ];
    })
  );
  const correct = observations.filter(
    (observation) => observation.actual === observation.expected
  ).length;
  const f1Values = Object.values(perClass).map((metrics) => metrics.f1);
  return {
    accuracy: ratio(correct, observations.length),
    confusion,
    correct,
    macroF1: average(f1Values),
    observations: observations.length,
    perClass,
  };
}

export function timingMetrics(values: number[]) {
  const sortedValues = values.toSorted((left, right) => left - right);
  return {
    max: sortedValues.at(-1) ?? 0,
    median: percentile(sortedValues, 0.5),
    p95: percentile(sortedValues, 0.95),
  };
}

function ratio(numerator: number, denominator: number) {
  return denominator === 0 ? 0 : numerator / denominator;
}

function harmonicMean(left: number, right: number) {
  return left + right === 0 ? 0 : (2 * left * right) / (left + right);
}

function average(values: number[]) {
  return values.length === 0
    ? 0
    : values.reduce((total, value) => total + value, 0) / values.length;
}

function percentile(sortedValues: number[], quantile: number) {
  if (sortedValues.length === 0) {
    return 0;
  }
  const index = Math.ceil(sortedValues.length * quantile) - 1;
  return sortedValues[Math.max(0, index)] ?? 0;
}
