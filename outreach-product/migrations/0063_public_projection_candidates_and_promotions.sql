-- PUBLIC-CANDIDATE-001 and PUBLIC-PROMOTION-001: immutable shadow candidates
-- followed by an explicitly authorized, atomic live activation.

CREATE TABLE public_projection_candidate_results (
  run_id TEXT NOT NULL REFERENCES public_projection_runs(id)
    ON DELETE RESTRICT,
  allocation_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('prepared','blocked')),
  reason_code TEXT NOT NULL CHECK (trim(reason_code)<>''),
  public_job_id TEXT,
  source_position_id TEXT REFERENCES job_source_positions(id)
    ON DELETE RESTRICT,
  candidate_id TEXT UNIQUE,
  candidate_hash TEXT CHECK (
    candidate_hash IS NULL OR length(candidate_hash)=64
  ),
  candidate_json TEXT CHECK (
    candidate_json IS NULL
    OR (json_valid(candidate_json) AND json_type(candidate_json)='object')
  ),
  created_at TEXT NOT NULL,
  PRIMARY KEY (run_id,allocation_id),
  FOREIGN KEY (run_id,allocation_id)
    REFERENCES public_projection_allocation_components(run_id,id)
    ON DELETE RESTRICT,
  CHECK (
    (state='prepared'
      AND reason_code='candidate_prepared'
      AND public_job_id IS NOT NULL
      AND source_position_id IS NOT NULL
      AND candidate_id IS NOT NULL
      AND candidate_hash IS NOT NULL
      AND candidate_json IS NOT NULL)
    OR (state='blocked'
      AND public_job_id IS NULL
      AND candidate_id IS NULL
      AND candidate_hash IS NULL
      AND candidate_json IS NULL)
  )
);

CREATE INDEX idx_projection_candidate_results_state
  ON public_projection_candidate_results(run_id,state,allocation_id);

CREATE TABLE public_projection_candidate_seals (
  run_id TEXT PRIMARY KEY REFERENCES public_projection_runs(id)
    ON DELETE RESTRICT,
  final_duplicate_seal_hash TEXT NOT NULL CHECK (
    length(final_duplicate_seal_hash)=64
  ),
  result_count INTEGER NOT NULL CHECK (result_count>=0),
  prepared_count INTEGER NOT NULL CHECK (prepared_count>=0),
  blocked_count INTEGER NOT NULL CHECK (blocked_count>=0),
  result_digest TEXT NOT NULL CHECK (length(result_digest)=64),
  created_at TEXT NOT NULL,
  CHECK (result_count=prepared_count+blocked_count)
);

CREATE TABLE public_projection_promotion_manifests (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  allocation_id TEXT NOT NULL,
  candidate_id TEXT NOT NULL,
  candidate_hash TEXT NOT NULL CHECK (length(candidate_hash)=64),
  candidate_seal_digest TEXT NOT NULL CHECK (
    length(candidate_seal_digest)=64
  ),
  predecessor_catalog_version TEXT NOT NULL REFERENCES
    public_job_catalog_versions(version) ON DELETE RESTRICT,
  activated_catalog_version TEXT NOT NULL REFERENCES
    public_job_catalog_versions(version) ON DELETE RESTRICT,
  public_job_id TEXT NOT NULL REFERENCES public_jobs(id) ON DELETE RESTRICT,
  public_job_version INTEGER NOT NULL CHECK (public_job_version>0),
  eligibility_decision_version INTEGER NOT NULL CHECK (
    eligibility_decision_version>0
  ),
  authorized_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  authorized_at TEXT NOT NULL,
  manifest_hash TEXT NOT NULL UNIQUE CHECK (length(manifest_hash)=64),
  completed_at TEXT NOT NULL,
  UNIQUE (run_id,allocation_id),
  UNIQUE (candidate_id),
  FOREIGN KEY (run_id,allocation_id)
    REFERENCES public_projection_candidate_results(run_id,allocation_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (public_job_id,public_job_version)
    REFERENCES public_job_versions(public_job_id,version)
    ON DELETE RESTRICT,
  FOREIGN KEY (public_job_id,eligibility_decision_version)
    REFERENCES public_job_eligibility_decisions(
      public_job_id,decision_version
    ) ON DELETE RESTRICT
);

CREATE TRIGGER trg_projection_candidate_result_validate
BEFORE INSERT ON public_projection_candidate_results
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
      FROM public_projection_allocation_components allocation
      JOIN public_projection_final_duplicate_seals seal
        ON seal.run_id=allocation.run_id
     WHERE allocation.run_id=NEW.run_id
       AND allocation.id=NEW.allocation_id
       AND (
         (NEW.state='prepared'
           AND allocation.state='promotable'
           AND NEW.public_job_id=COALESCE(
             allocation.winning_public_job_id,
             allocation.proposed_public_job_id
           )
           AND NEW.source_position_id=
             allocation.founding_source_position_id)
         OR (NEW.state='blocked')
       )
  ) THEN RAISE(ABORT,'candidate result does not match sealed allocation') END;
END;

CREATE TRIGGER trg_projection_candidate_result_immutable_update
BEFORE UPDATE ON public_projection_candidate_results
BEGIN
  SELECT RAISE(ABORT,'public projection candidate results are immutable');
END;

CREATE TRIGGER trg_projection_candidate_result_immutable_delete
BEFORE DELETE ON public_projection_candidate_results
BEGIN
  SELECT RAISE(ABORT,'public projection candidate results are append-only');
END;

CREATE TRIGGER trg_projection_candidate_seal_validate
BEFORE INSERT ON public_projection_candidate_seals
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
      FROM public_projection_final_duplicate_seals final_seal
     WHERE final_seal.run_id=NEW.run_id
       AND final_seal.seal_hash=NEW.final_duplicate_seal_hash
       AND final_seal.allocation_count=NEW.result_count
       AND final_seal.promotable_count>=NEW.prepared_count
       AND final_seal.blocked_allocation_count<=NEW.blocked_count
       AND NEW.result_count=(
         SELECT COUNT(*) FROM public_projection_candidate_results result
          WHERE result.run_id=NEW.run_id
       )
       AND NEW.prepared_count=(
         SELECT COUNT(*) FROM public_projection_candidate_results result
          WHERE result.run_id=NEW.run_id AND result.state='prepared'
       )
       AND NEW.blocked_count=(
         SELECT COUNT(*) FROM public_projection_candidate_results result
          WHERE result.run_id=NEW.run_id AND result.state='blocked'
       )
  ) THEN RAISE(ABORT,'candidate seal does not match immutable results') END;
END;

CREATE TRIGGER trg_projection_candidate_seal_immutable_update
BEFORE UPDATE ON public_projection_candidate_seals
BEGIN
  SELECT RAISE(ABORT,'public projection candidate seals are immutable');
END;

CREATE TRIGGER trg_projection_candidate_seal_immutable_delete
BEFORE DELETE ON public_projection_candidate_seals
BEGIN
  SELECT RAISE(ABORT,'public projection candidate seals are append-only');
END;

CREATE TRIGGER trg_projection_promotion_manifest_validate
BEFORE INSERT ON public_projection_promotion_manifests
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
      FROM public_projection_candidate_results candidate
      JOIN public_projection_candidate_seals seal
        ON seal.run_id=candidate.run_id
     WHERE candidate.run_id=NEW.run_id
       AND candidate.allocation_id=NEW.allocation_id
       AND candidate.state='prepared'
       AND candidate.candidate_id=NEW.candidate_id
       AND candidate.candidate_hash=NEW.candidate_hash
       AND seal.result_digest=NEW.candidate_seal_digest
  ) THEN RAISE(ABORT,'promotion manifest lost its candidate seal') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM users
     WHERE id=NEW.authorized_by_user_id AND role='operator'
  ) THEN RAISE(ABORT,'promotion requires an operator') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM public_job_catalog_head_pointer
     WHERE singleton=1
       AND current_version=NEW.activated_catalog_version
  ) THEN RAISE(ABORT,'promotion catalog activation is incomplete') END;
END;

CREATE TRIGGER trg_projection_promotion_manifest_immutable_update
BEFORE UPDATE ON public_projection_promotion_manifests
BEGIN
  SELECT RAISE(ABORT,'public projection promotion manifests are immutable');
END;

CREATE TRIGGER trg_projection_promotion_manifest_immutable_delete
BEFORE DELETE ON public_projection_promotion_manifests
BEGIN
  SELECT RAISE(ABORT,'public projection promotion manifests are append-only');
END;
