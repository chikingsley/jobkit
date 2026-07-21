import type { ClassificationLabel } from "@/test-lab/classification-review";

export const classificationLabels: Array<{
  description: string;
  label: string;
  value: ClassificationLabel;
}> = [
  {
    description: "The vacancy is primarily for teaching English.",
    label: "English teaching",
    value: "english_teaching",
  },
  {
    description: "The vacancy is primarily for another academic subject.",
    label: "Subject teaching",
    value: "subject_teaching",
  },
  {
    description:
      "The item is a non-classroom role, service, or training offer.",
    label: "Non-teaching",
    value: "non_teaching",
  },
  {
    description: "The source does not support one broad class confidently.",
    label: "Unclear",
    value: "unclear",
  },
];

const LABELS = new Map(
  classificationLabels.map((item) => [item.value, item.label])
);

export function classificationLabel(value: ClassificationLabel) {
  return LABELS.get(value) ?? value;
}
