export const CORPUS_LABELS = [
  "english_teaching",
  "subject_teaching",
  "non_teaching",
  "unclear",
] as const;

export const LABEL_CONFIDENCE = ["high", "medium", "low"] as const;

export const FINAL_LABEL_PROVENANCE = [
  "model_agreement",
  "model_agreement_low_confidence",
  "operator_adjudication",
] as const;

export const CORPUS_SPLITS = ["train", "held_out"] as const;

export type CorpusLabel = (typeof CORPUS_LABELS)[number];
export type LabelConfidence = (typeof LABEL_CONFIDENCE)[number];
export type FinalLabelProvenance = (typeof FINAL_LABEL_PROVENANCE)[number];
export type CorpusSplit = (typeof CORPUS_SPLITS)[number];

export interface CorpusItem {
  board: string;
  company: string;
  country: string;
  description: string;
  duplicateGroup: string;
  itemId: string;
  sourceHash: string;
  sourceUrl: string;
  title: string;
}

export interface CorpusLabelResult {
  confidence: LabelConfidence;
  evidence: string;
  itemId: string;
  label: CorpusLabel;
  rationale: string;
}

export interface CorpusFinalLabel {
  itemId: string;
  label: CorpusLabel;
  notes: string;
  provenance: FinalLabelProvenance;
  sourceHash: string;
}

export interface CorpusGroupAssignment {
  basis: string;
  groupId: string;
  itemId: string;
}

export interface CorpusSplitAssignment {
  itemId: string;
  split: CorpusSplit;
}

export interface SourceListing {
  board: string;
  company: string;
  country: string;
  description: string;
  id: string;
  sourceUrl: string;
  title: string;
}

export const CORPUS_VERSION = "jobkit-jina-real-listings-v1";
