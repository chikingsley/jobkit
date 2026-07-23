import type { Database } from "bun:sqlite";

export function initializeCorpusLedger(database: Database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS corpus_versions (
      corpus_version TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      source_database TEXT NOT NULL,
      sample_size INTEGER NOT NULL,
      sampling_protocol TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS corpus_items (
      corpus_version TEXT NOT NULL REFERENCES corpus_versions(corpus_version),
      item_id TEXT NOT NULL,
      board TEXT NOT NULL,
      title TEXT NOT NULL,
      company TEXT NOT NULL,
      country TEXT NOT NULL,
      description TEXT NOT NULL,
      source_url TEXT NOT NULL,
      source_hash TEXT NOT NULL,
      duplicate_group TEXT NOT NULL,
      PRIMARY KEY (corpus_version, item_id)
    );
    CREATE INDEX IF NOT EXISTS corpus_items_duplicate_group
      ON corpus_items(corpus_version, duplicate_group);
    CREATE TABLE IF NOT EXISTS labeling_runs (
      corpus_version TEXT NOT NULL REFERENCES corpus_versions(corpus_version),
      pass_id TEXT NOT NULL,
      model TEXT NOT NULL,
      reasoning_effort TEXT NOT NULL,
      prompt_version TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      PRIMARY KEY (corpus_version, pass_id)
    );
    CREATE TABLE IF NOT EXISTS corpus_labels (
      corpus_version TEXT NOT NULL,
      item_id TEXT NOT NULL,
      pass_id TEXT NOT NULL,
      label TEXT NOT NULL CHECK(label IN ('english_teaching','subject_teaching','non_teaching','unclear')),
      confidence TEXT NOT NULL CHECK(confidence IN ('high','medium','low')),
      rationale TEXT NOT NULL,
      evidence TEXT NOT NULL,
      labeled_at TEXT NOT NULL,
      PRIMARY KEY (corpus_version, item_id, pass_id),
      FOREIGN KEY (corpus_version, item_id)
        REFERENCES corpus_items(corpus_version, item_id),
      FOREIGN KEY (corpus_version, pass_id)
        REFERENCES labeling_runs(corpus_version, pass_id)
    );
    CREATE TABLE IF NOT EXISTS corpus_adjudications (
      corpus_version TEXT NOT NULL,
      item_id TEXT NOT NULL,
      source_hash TEXT NOT NULL,
      label TEXT NOT NULL CHECK(label IN ('english_teaching','subject_teaching','non_teaching','unclear')),
      notes TEXT NOT NULL,
      review_source TEXT NOT NULL,
      reviewed_at TEXT NOT NULL,
      PRIMARY KEY (corpus_version, item_id),
      FOREIGN KEY (corpus_version, item_id)
        REFERENCES corpus_items(corpus_version, item_id)
    );
    CREATE TABLE IF NOT EXISTS corpus_final_labels (
      corpus_version TEXT NOT NULL,
      item_id TEXT NOT NULL,
      source_hash TEXT NOT NULL,
      label TEXT NOT NULL CHECK(label IN ('english_teaching','subject_teaching','non_teaching','unclear')),
      provenance TEXT NOT NULL CHECK(provenance IN ('model_agreement','model_agreement_low_confidence','operator_adjudication')),
      notes TEXT NOT NULL,
      finalized_at TEXT NOT NULL,
      PRIMARY KEY (corpus_version, item_id),
      FOREIGN KEY (corpus_version, item_id)
        REFERENCES corpus_items(corpus_version, item_id)
    );
    CREATE TABLE IF NOT EXISTS corpus_group_assignments (
      corpus_version TEXT NOT NULL,
      item_id TEXT NOT NULL,
      group_id TEXT NOT NULL,
      basis TEXT NOT NULL,
      assigned_at TEXT NOT NULL,
      PRIMARY KEY (corpus_version, item_id),
      FOREIGN KEY (corpus_version, item_id)
        REFERENCES corpus_items(corpus_version, item_id)
    );
    CREATE INDEX IF NOT EXISTS corpus_group_assignments_group
      ON corpus_group_assignments(corpus_version, group_id);
    CREATE TABLE IF NOT EXISTS corpus_split_assignments (
      corpus_version TEXT NOT NULL,
      split_version TEXT NOT NULL,
      item_id TEXT NOT NULL,
      split TEXT NOT NULL CHECK(split IN ('train','held_out')),
      assigned_at TEXT NOT NULL,
      PRIMARY KEY (corpus_version, split_version, item_id),
      FOREIGN KEY (corpus_version, item_id)
        REFERENCES corpus_items(corpus_version, item_id)
    );
    CREATE TABLE IF NOT EXISTS classifier_experiments (
      experiment_id TEXT PRIMARY KEY,
      corpus_version TEXT NOT NULL REFERENCES corpus_versions(corpus_version),
      split_version TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      classifier_id TEXT NOT NULL,
      training_samples INTEGER NOT NULL,
      held_out_samples INTEGER NOT NULL,
      num_iters INTEGER NOT NULL,
      zero_shot_metrics_json TEXT NOT NULL,
      few_shot_metrics_json TEXT NOT NULL,
      artifact_path TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
}
