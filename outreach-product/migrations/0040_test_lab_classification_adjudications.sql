CREATE TABLE test_lab_classification_adjudications (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  corpus_version TEXT NOT NULL,
  item_id TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  label TEXT NOT NULL CHECK (
    label IN ('english_teaching','subject_teaching','non_teaching','unclear')
  ),
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id,corpus_version,item_id)
);

CREATE INDEX idx_test_lab_classification_adjudications_user_updated
  ON test_lab_classification_adjudications(user_id,updated_at DESC);
