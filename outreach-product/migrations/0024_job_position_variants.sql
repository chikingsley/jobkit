CREATE TABLE job_position_analyses (
  job_id TEXT PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK (scope IN ('direct','multi_position','ambiguous')),
  review_notes_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(review_notes_json)),
  schema_version INTEGER NOT NULL,
  model_provider TEXT NOT NULL,
  model_id TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_job_position_analyses_version
  ON job_position_analyses(schema_version,updated_at DESC);

CREATE TABLE job_position_variants (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  title TEXT NOT NULL,
  role_family TEXT NOT NULL CHECK (
    role_family IN (
      'early_childhood','english_language','homeroom','leadership',
      'student_support','subject_specialist','other'
    )
  ),
  subjects_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(subjects_json)),
  locations_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(locations_json)),
  audiences_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(audiences_json)),
  employment_types_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(employment_types_json)),
  requirements_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(requirements_json)),
  evidence_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(evidence_json)),
  compensation_evidence_json TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(compensation_evidence_json)),
  certainty TEXT NOT NULL CHECK (certainty IN ('explicit','ambiguous')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(job_id,ordinal)
);

CREATE INDEX idx_job_position_variants_job_role
  ON job_position_variants(job_id,role_family,ordinal);
