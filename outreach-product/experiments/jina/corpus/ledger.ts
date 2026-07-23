import { Database } from "bun:sqlite";
import type {
  CorpusFinalLabel,
  CorpusGroupAssignment,
  CorpusItem,
  CorpusLabel,
  CorpusLabelResult,
  CorpusSplitAssignment,
  LabelConfidence,
} from "./contracts";
import { initializeCorpusLedger } from "./ledger-schema";

interface CorpusItemRow {
  board: string;
  company: string;
  country: string;
  description: string;
  duplicate_group: string;
  item_id: string;
  source_hash: string;
  source_url: string;
  title: string;
}

interface LabelRow {
  confidence: LabelConfidence;
  evidence: string;
  item_id: string;
  label: CorpusLabel;
  rationale: string;
}

export interface LabelRunMetadata {
  corpusVersion: string;
  model: string;
  passId: string;
  promptVersion: string;
  reasoningEffort: string;
}

export function openCorpusLedger(path: string) {
  const database = new Database(path, { create: true, strict: true });
  database.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
  initializeCorpusLedger(database);
  return database;
}

export function saveClassifierExperiment(
  database: Database,
  input: {
    artifactPath: string;
    classifierId: string;
    corpusVersion: string;
    experimentId: string;
    fewShotMetrics: unknown;
    heldOutSamples: number;
    model: string;
    numIters: number;
    splitVersion: string;
    trainingSamples: number;
    zeroShotMetrics: unknown;
  }
) {
  database
    .query(
      `INSERT INTO classifier_experiments (
         experiment_id,corpus_version,split_version,provider,model,
         classifier_id,training_samples,held_out_samples,num_iters,
         zero_shot_metrics_json,few_shot_metrics_json,artifact_path,created_at
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      input.experimentId,
      input.corpusVersion,
      input.splitVersion,
      "jina",
      input.model,
      input.classifierId,
      input.trainingSamples,
      input.heldOutSamples,
      input.numIters,
      JSON.stringify(input.zeroShotMetrics),
      JSON.stringify(input.fewShotMetrics),
      input.artifactPath,
      new Date().toISOString()
    );
}

export function freezeCorpus(
  database: Database,
  input: {
    adjudications: Array<{
      itemId: string;
      label: CorpusLabel;
      notes: string;
      reviewedAt: string;
      sourceHash: string;
    }>;
    assignments: CorpusSplitAssignment[];
    corpusVersion: string;
    finalLabels: CorpusFinalLabel[];
    groups: CorpusGroupAssignment[];
    reviewSource: string;
    splitVersion: string;
  }
) {
  const frozen = database
    .query(
      "SELECT COUNT(*) count FROM corpus_final_labels WHERE corpus_version=?"
    )
    .get(input.corpusVersion) as { count: number };
  if (frozen.count > 0) {
    throw new Error(
      `Corpus ${input.corpusVersion} is already frozen with ${frozen.count} labels`
    );
  }
  const insertAdjudication = database.query(`
    INSERT INTO corpus_adjudications (
      corpus_version,item_id,source_hash,label,notes,review_source,reviewed_at
    ) VALUES (?,?,?,?,?,?,?)
  `);
  const insertFinalLabel = database.query(`
    INSERT INTO corpus_final_labels (
      corpus_version,item_id,source_hash,label,provenance,notes,finalized_at
    ) VALUES (?,?,?,?,?,?,?)
  `);
  const insertGroup = database.query(`
    INSERT INTO corpus_group_assignments (
      corpus_version,item_id,group_id,basis,assigned_at
    ) VALUES (?,?,?,?,?)
  `);
  const insertSplit = database.query(`
    INSERT INTO corpus_split_assignments (
      corpus_version,split_version,item_id,split,assigned_at
    ) VALUES (?,?,?,?,?)
  `);
  database.transaction(() => {
    const timestamp = new Date().toISOString();
    for (const decision of input.adjudications) {
      insertAdjudication.run(
        input.corpusVersion,
        decision.itemId,
        decision.sourceHash,
        decision.label,
        decision.notes,
        input.reviewSource,
        decision.reviewedAt
      );
    }
    for (const label of input.finalLabels) {
      insertFinalLabel.run(
        input.corpusVersion,
        label.itemId,
        label.sourceHash,
        label.label,
        label.provenance,
        label.notes,
        timestamp
      );
    }
    for (const assignment of input.groups) {
      insertGroup.run(
        input.corpusVersion,
        assignment.itemId,
        assignment.groupId,
        assignment.basis,
        timestamp
      );
    }
    for (const assignment of input.assignments) {
      insertSplit.run(
        input.corpusVersion,
        input.splitVersion,
        assignment.itemId,
        assignment.split,
        timestamp
      );
    }
  })();
}

export function createCorpus(
  database: Database,
  input: {
    corpusVersion: string;
    items: CorpusItem[];
    samplingProtocol: string;
    sourceDatabase: string;
  }
) {
  const existing = database
    .query("SELECT COUNT(*) count FROM corpus_items WHERE corpus_version = ?")
    .get(input.corpusVersion) as { count: number };
  if (existing.count > 0) {
    throw new Error(
      `Corpus ${input.corpusVersion} already contains ${existing.count} items`
    );
  }
  const insertVersion = database.query(`
    INSERT INTO corpus_versions (
      corpus_version, created_at, source_database, sample_size, sampling_protocol
    ) VALUES (?, ?, ?, ?, ?)
  `);
  const insertItem = database.query(`
    INSERT INTO corpus_items (
      corpus_version, item_id, board, title, company, country, description,
      source_url, source_hash, duplicate_group
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  database.transaction(() => {
    insertVersion.run(
      input.corpusVersion,
      new Date().toISOString(),
      input.sourceDatabase,
      input.items.length,
      input.samplingProtocol
    );
    for (const item of input.items) {
      insertItem.run(
        input.corpusVersion,
        item.itemId,
        item.board,
        item.title,
        item.company,
        item.country,
        item.description,
        item.sourceUrl,
        item.sourceHash,
        item.duplicateGroup
      );
    }
  })();
}

export function corpusItems(database: Database, corpusVersion: string) {
  const rows = database
    .query(
      `SELECT item_id, board, title, company, country, description,
              source_url, source_hash, duplicate_group
         FROM corpus_items
        WHERE corpus_version = ?
        ORDER BY board, item_id`
    )
    .all(corpusVersion) as CorpusItemRow[];
  return rows.map(toCorpusItem);
}

export function beginLabelRun(database: Database, metadata: LabelRunMetadata) {
  database
    .query(
      `INSERT INTO labeling_runs (
         corpus_version, pass_id, model, reasoning_effort, prompt_version,
         started_at, completed_at
       ) VALUES (?, ?, ?, ?, ?, ?, NULL)
       ON CONFLICT(corpus_version, pass_id) DO UPDATE SET
         model = excluded.model,
         reasoning_effort = excluded.reasoning_effort,
         prompt_version = excluded.prompt_version,
         completed_at = NULL`
    )
    .run(
      metadata.corpusVersion,
      metadata.passId,
      metadata.model,
      metadata.reasoningEffort,
      metadata.promptVersion,
      new Date().toISOString()
    );
}

export function saveLabels(
  database: Database,
  metadata: LabelRunMetadata,
  labels: CorpusLabelResult[]
) {
  const insert = database.query(`
    INSERT INTO corpus_labels (
      corpus_version, item_id, pass_id, label, confidence, rationale,
      evidence, labeled_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(corpus_version, item_id, pass_id) DO UPDATE SET
      label = excluded.label,
      confidence = excluded.confidence,
      rationale = excluded.rationale,
      evidence = excluded.evidence,
      labeled_at = excluded.labeled_at
  `);
  database.transaction(() => {
    for (const label of labels) {
      insert.run(
        metadata.corpusVersion,
        label.itemId,
        metadata.passId,
        label.label,
        label.confidence,
        label.rationale,
        label.evidence,
        new Date().toISOString()
      );
    }
  })();
}

export function completeLabelRun(
  database: Database,
  corpusVersion: string,
  passId: string
) {
  database
    .query(
      `UPDATE labeling_runs
          SET completed_at = ?
        WHERE corpus_version = ? AND pass_id = ?`
    )
    .run(new Date().toISOString(), corpusVersion, passId);
}

export function corpusStatus(database: Database, corpusVersion: string) {
  const totals = database
    .query(
      `SELECT COUNT(*) items,
              COUNT(DISTINCT board) boards,
              COUNT(DISTINCT country) countries,
              COUNT(DISTINCT duplicate_group) source_hash_groups
         FROM corpus_items
        WHERE corpus_version = ?`
    )
    .get(corpusVersion);
  const passes = database
    .query(
      `SELECT r.pass_id, r.model, r.reasoning_effort, r.started_at,
              r.completed_at, COUNT(l.item_id) labels
         FROM labeling_runs r
         LEFT JOIN corpus_labels l
           ON l.corpus_version = r.corpus_version AND l.pass_id = r.pass_id
        WHERE r.corpus_version = ?
        GROUP BY r.pass_id, r.model, r.reasoning_effort, r.started_at,
                 r.completed_at
        ORDER BY r.pass_id`
    )
    .all(corpusVersion);
  const agreement = database
    .query(
      `WITH paired AS (
         SELECT item_id, COUNT(*) labels, COUNT(DISTINCT label) distinct_labels,
                MAX(CASE WHEN confidence = 'low' THEN 1 ELSE 0 END)
                  has_low_confidence
           FROM corpus_labels
          WHERE corpus_version = ?
          GROUP BY item_id
       )
       SELECT COUNT(*) paired_items,
              COALESCE(SUM(labels = 2 AND distinct_labels = 1), 0) agreements,
              COALESCE(SUM(labels = 2 AND distinct_labels > 1), 0) disagreements,
              COALESCE(SUM(labels = 2 AND has_low_confidence = 1), 0)
                low_confidence
         FROM paired
        WHERE labels = 2`
    )
    .get(corpusVersion);
  const distribution = database
    .query(
      `SELECT pass_id, label, COUNT(*) count
         FROM corpus_labels
        WHERE corpus_version = ?
        GROUP BY pass_id, label
        ORDER BY pass_id, label`
    )
    .all(corpusVersion);
  const finalLabels = database
    .query(
      `SELECT provenance,label,COUNT(*) count
         FROM corpus_final_labels
        WHERE corpus_version=?
        GROUP BY provenance,label
        ORDER BY provenance,label`
    )
    .all(corpusVersion);
  const groups = database
    .query(
      `SELECT COUNT(DISTINCT group_id) groups,
              COALESCE(MAX(member_count),0) largest_group,
              COALESCE(SUM(member_count > 1),0) multi_item_groups
         FROM (
           SELECT group_id,COUNT(*) member_count
             FROM corpus_group_assignments
            WHERE corpus_version=?
            GROUP BY group_id
         )`
    )
    .get(corpusVersion);
  const splits = database
    .query(
      `SELECT s.split,f.label,COUNT(*) count
         FROM corpus_split_assignments s
         JOIN corpus_final_labels f
           ON f.corpus_version=s.corpus_version AND f.item_id=s.item_id
        WHERE s.corpus_version=?
        GROUP BY s.split,f.label
        ORDER BY s.split,f.label`
    )
    .all(corpusVersion);
  const experiments = database
    .query(
      `SELECT experiment_id,model,training_samples,held_out_samples,
              created_at
         FROM classifier_experiments
        WHERE corpus_version=?
        ORDER BY created_at DESC`
    )
    .all(corpusVersion);
  return {
    agreement,
    distribution,
    experiments,
    finalLabels,
    groups,
    passes,
    splits,
    totals,
  };
}

export function labelsForPass(
  database: Database,
  corpusVersion: string,
  passId: string
) {
  return database
    .query(
      `SELECT item_id, label, confidence, rationale, evidence
         FROM corpus_labels
        WHERE corpus_version = ? AND pass_id = ?
        ORDER BY item_id`
    )
    .all(corpusVersion, passId) as LabelRow[];
}

function toCorpusItem(row: CorpusItemRow): CorpusItem {
  return {
    board: row.board,
    company: row.company,
    country: row.country,
    description: row.description,
    duplicateGroup: row.duplicate_group,
    itemId: row.item_id,
    sourceHash: row.source_hash,
    sourceUrl: row.source_url,
    title: row.title,
  };
}
