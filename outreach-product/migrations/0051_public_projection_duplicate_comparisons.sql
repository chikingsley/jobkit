-- PUBLIC-DATA-001 Phase D2: bounded immutable duplicate snapshots.
-- This remains shadow-only. It allocates no public job and grants no exposure.

CREATE TABLE public_projection_duplicate_work (
  run_id TEXT PRIMARY KEY REFERENCES public_projection_runs(id)
    ON DELETE RESTRICT,
  retrieval_algorithm_version TEXT NOT NULL CHECK (
    retrieval_algorithm_version='public-duplicate-retrieval-v1'
  ),
  phase TEXT NOT NULL CHECK (
    phase IN ('members','existing_public','same_run','ready','sealed')
  ),
  status TEXT NOT NULL CHECK (
    status IN ('queued','processing','sealed')
  ),
  expected_member_count INTEGER NOT NULL CHECK (expected_member_count>=0),
  member_count INTEGER NOT NULL DEFAULT 0 CHECK (member_count>=0),
  comparison_count INTEGER NOT NULL DEFAULT 0 CHECK (comparison_count>=0),
  member_cursor TEXT NOT NULL DEFAULT '',
  existing_public_cursor TEXT NOT NULL DEFAULT '',
  same_run_owner_cursor TEXT NOT NULL DEFAULT '',
  same_run_target_cursor TEXT NOT NULL DEFAULT '',
  member_digest TEXT NOT NULL CHECK (length(member_digest)=64),
  comparison_digest TEXT NOT NULL CHECK (length(comparison_digest)=64),
  lease_token TEXT,
  lease_expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (member_count<=expected_member_count),
  CHECK (
    (status='processing' AND lease_token IS NOT NULL
      AND trim(lease_token)<>'' AND lease_expires_at IS NOT NULL
      AND trim(lease_expires_at)<>'')
    OR (status<>'processing' AND lease_token IS NULL
      AND lease_expires_at IS NULL)
  ),
  CHECK ((phase='sealed')=(status='sealed'))
);

-- A sentinel statement placed directly after a required write turns an
-- unexpected changes() count into a constraint error inside the same D1
-- batch. The AFTER trigger keeps this table empty.
CREATE TABLE public_projection_duplicate_assertions (
  expected_changes INTEGER NOT NULL CHECK (expected_changes>=0),
  actual_changes INTEGER NOT NULL,
  CHECK (actual_changes=expected_changes)
);

CREATE TRIGGER trg_projection_duplicate_assertion_consume
AFTER INSERT ON public_projection_duplicate_assertions
BEGIN
  DELETE FROM public_projection_duplicate_assertions
   WHERE rowid=NEW.rowid;
END;

CREATE TABLE public_projection_duplicate_batch_members (
  run_id TEXT NOT NULL REFERENCES public_projection_runs(id)
    ON DELETE RESTRICT,
  ordinal INTEGER NOT NULL CHECK (ordinal>=0),
  position_item_id TEXT NOT NULL,
  source_position_id TEXT NOT NULL,
  input_hash TEXT NOT NULL CHECK (length(input_hash)=64),
  listing_id TEXT NOT NULL,
  source_key TEXT NOT NULL,
  position_key TEXT NOT NULL,
  source_reference TEXT NOT NULL,
  source_reference_signal_hash TEXT CHECK (
    source_reference_signal_hash IS NULL
    OR length(source_reference_signal_hash)=64
  ),
  material_signal_hash TEXT NOT NULL CHECK (
    length(material_signal_hash)=64
  ),
  created_at TEXT NOT NULL,
  PRIMARY KEY (run_id,position_item_id),
  UNIQUE (run_id,ordinal),
  FOREIGN KEY (position_item_id,run_id)
    REFERENCES public_projection_position_items(id,run_id)
    ON DELETE RESTRICT
);

CREATE INDEX idx_projection_duplicate_member_listing
  ON public_projection_duplicate_batch_members(
    run_id,listing_id,position_item_id
  );

CREATE INDEX idx_projection_duplicate_member_source_reference
  ON public_projection_duplicate_batch_members(
    run_id,source_key,position_key,source_reference,position_item_id
  );

CREATE INDEX idx_projection_duplicate_member_material
  ON public_projection_duplicate_batch_members(
    run_id,material_signal_hash,position_key,position_item_id
  );

CREATE TABLE public_projection_duplicate_comparisons (
  id TEXT PRIMARY KEY CHECK (
    length(id)=72
    AND substr(id,1,8)='pdup_v1_'
    AND substr(id,9) NOT GLOB '*[^0-9a-f]*'
  ),
  run_id TEXT NOT NULL REFERENCES public_projection_runs(id)
    ON DELETE RESTRICT,
  owner_position_item_id TEXT NOT NULL,
  owner_source_position_id TEXT NOT NULL,
  owner_input_hash TEXT NOT NULL CHECK (length(owner_input_hash)=64),
  target_kind TEXT NOT NULL CHECK (
    target_kind IN ('existing_public','same_run')
  ),
  target_public_job_id TEXT,
  target_public_job_version INTEGER CHECK (
    target_public_job_version IS NULL OR target_public_job_version>0
  ),
  target_redirect_root_id TEXT REFERENCES public_jobs(id)
    ON DELETE RESTRICT,
  target_position_item_id TEXT,
  target_source_position_id TEXT,
  target_input_hash TEXT CHECK (
    target_input_hash IS NULL OR length(target_input_hash)=64
  ),
  retrieval_algorithm_version TEXT NOT NULL CHECK (
    retrieval_algorithm_version='public-duplicate-retrieval-v1'
  ),
  matching_signals_json TEXT NOT NULL CHECK (
    json_valid(matching_signals_json)
    AND json_type(matching_signals_json)='array'
  ),
  conflicting_signals_json TEXT NOT NULL CHECK (
    json_valid(conflicting_signals_json)
    AND json_type(conflicting_signals_json)='array'
  ),
  relation TEXT NOT NULL CHECK (
    relation IN ('same','different','ambiguous')
  ),
  reason_code TEXT NOT NULL CHECK (
    reason_code IN (
      'same_source_position','same_source_reference_position',
      'same_listing_distinct_position','conflicting_stable_identifier',
      'canonical_identity_only','duplicate_evidence_conflict'
    )
  ),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL CHECK (updated_at=created_at),
  FOREIGN KEY (owner_position_item_id,run_id)
    REFERENCES public_projection_position_items(id,run_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (target_position_item_id,run_id)
    REFERENCES public_projection_position_items(id,run_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (target_public_job_id,target_public_job_version)
    REFERENCES public_job_versions(public_job_id,version)
    ON DELETE RESTRICT,
  CHECK (
    (
      target_kind='same_run'
      AND target_position_item_id IS NOT NULL
      AND target_source_position_id IS NOT NULL
      AND target_input_hash IS NOT NULL
      AND target_public_job_id IS NULL
      AND target_public_job_version IS NULL
      AND target_redirect_root_id IS NULL
      AND owner_position_item_id<target_position_item_id
      AND owner_source_position_id<>target_source_position_id
    )
    OR (
      target_kind='existing_public'
      AND target_position_item_id IS NULL
      AND target_source_position_id IS NULL
      AND target_input_hash IS NULL
      AND target_public_job_id IS NOT NULL
      AND target_public_job_version IS NOT NULL
      AND target_redirect_root_id IS NOT NULL
    )
  ),
  CHECK (
    (relation='same' AND reason_code IN (
      'same_source_position','same_source_reference_position'
    ))
    OR (relation='different' AND reason_code IN (
      'same_listing_distinct_position','conflicting_stable_identifier'
    ))
    OR (relation='ambiguous' AND reason_code IN (
      'canonical_identity_only','duplicate_evidence_conflict'
    ))
  )
);

CREATE UNIQUE INDEX idx_projection_duplicate_same_run_target
  ON public_projection_duplicate_comparisons(
    run_id,owner_position_item_id,target_position_item_id
  )
  WHERE target_kind='same_run';

CREATE UNIQUE INDEX idx_projection_duplicate_public_target
  ON public_projection_duplicate_comparisons(
    run_id,owner_position_item_id,target_redirect_root_id,
    target_public_job_version
  )
  WHERE target_kind='existing_public';

CREATE INDEX idx_projection_duplicate_owner
  ON public_projection_duplicate_comparisons(
    run_id,owner_position_item_id,target_kind,id
  );

CREATE TABLE public_projection_duplicate_batches (
  run_id TEXT PRIMARY KEY REFERENCES public_projection_runs(id)
    ON DELETE RESTRICT,
  retrieval_algorithm_version TEXT NOT NULL CHECK (
    retrieval_algorithm_version='public-duplicate-retrieval-v1'
  ),
  input_hash TEXT NOT NULL CHECK (length(input_hash)=64),
  position_member_count INTEGER NOT NULL CHECK (position_member_count>=0),
  comparison_count INTEGER NOT NULL CHECK (comparison_count>=0),
  member_digest TEXT NOT NULL CHECK (length(member_digest)=64),
  comparison_digest TEXT NOT NULL CHECK (length(comparison_digest)=64),
  canonical_identity_state TEXT NOT NULL CHECK (
    canonical_identity_state='pending'
  ),
  created_at TEXT NOT NULL
);

CREATE TRIGGER trg_projection_duplicate_work_insert_validate
BEFORE INSERT ON public_projection_duplicate_work
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM public_projection_runs run
     WHERE run.id=NEW.run_id AND run.mode='shadow'
       AND run.status='running' AND run.selection_complete=1
  ) THEN RAISE(ABORT,'duplicate work run is not stable') END;

  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM public_projection_listing_items item
     WHERE item.run_id=NEW.run_id
       AND item.status IN ('queued','processing','waiting_analysis')
  ) OR EXISTS (
    SELECT 1 FROM public_projection_position_items item
     WHERE item.run_id=NEW.run_id AND item.stage='identity'
       AND item.status IN ('queued','processing','waiting_analysis')
  ) THEN RAISE(ABORT,'duplicate work identity boundary is active') END;

  SELECT CASE WHEN NEW.expected_member_count<>(
    SELECT COUNT(*) FROM public_projection_position_items item
     WHERE item.run_id=NEW.run_id
       AND item.stage='canonical_resolution' AND item.status='queued'
  ) THEN RAISE(ABORT,'duplicate work member count changed') END;
END;

CREATE TRIGGER trg_projection_duplicate_work_update_guard
BEFORE UPDATE ON public_projection_duplicate_work
BEGIN
  SELECT CASE WHEN
    NEW.run_id IS NOT OLD.run_id
    OR NEW.retrieval_algorithm_version IS NOT OLD.retrieval_algorithm_version
    OR NEW.expected_member_count IS NOT OLD.expected_member_count
    OR NEW.created_at IS NOT OLD.created_at
  THEN RAISE(ABORT,'duplicate work snapshot is immutable') END;

  SELECT CASE WHEN NEW.member_count<OLD.member_count
    OR NEW.comparison_count<OLD.comparison_count
  THEN RAISE(ABORT,'duplicate work progress cannot move backward') END;

  SELECT CASE WHEN OLD.phase='sealed' AND (
    NEW.phase IS NOT OLD.phase OR NEW.status IS NOT OLD.status
    OR NEW.member_count IS NOT OLD.member_count
    OR NEW.comparison_count IS NOT OLD.comparison_count
    OR NEW.member_cursor IS NOT OLD.member_cursor
    OR NEW.existing_public_cursor IS NOT OLD.existing_public_cursor
    OR NEW.same_run_owner_cursor IS NOT OLD.same_run_owner_cursor
    OR NEW.same_run_target_cursor IS NOT OLD.same_run_target_cursor
    OR NEW.member_digest IS NOT OLD.member_digest
    OR NEW.comparison_digest IS NOT OLD.comparison_digest
    OR NEW.lease_token IS NOT OLD.lease_token
    OR NEW.lease_expires_at IS NOT OLD.lease_expires_at
    OR NEW.updated_at IS NOT OLD.updated_at
  ) THEN RAISE(ABORT,'sealed duplicate work is immutable') END;
END;

CREATE TRIGGER trg_projection_duplicate_work_delete_guard
BEFORE DELETE ON public_projection_duplicate_work
WHEN EXISTS (
  SELECT 1 FROM public_projection_duplicate_batches batch
   WHERE batch.run_id=OLD.run_id
)
BEGIN
  SELECT RAISE(ABORT,'sealed duplicate work is append-only');
END;

CREATE TRIGGER trg_projection_duplicate_member_validate
BEFORE INSERT ON public_projection_duplicate_batch_members
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM public_projection_duplicate_batches batch
     WHERE batch.run_id=NEW.run_id
  ) THEN RAISE(ABORT,'duplicate batch members are sealed') END;

  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM public_projection_duplicate_work work
     WHERE work.run_id=NEW.run_id AND work.phase='members'
       AND work.status='processing'
  ) THEN RAISE(ABORT,'duplicate member work lease is unavailable') END;

  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
      FROM public_projection_position_items item
      JOIN public_projection_listing_items listing_item
        ON listing_item.id=item.listing_item_id
       AND listing_item.run_id=item.run_id
      JOIN job_source_positions source_position
        ON source_position.id=item.source_position_id
      JOIN job_listing_versions version
        ON version.listing_id=listing_item.listing_id
       AND version.material_version=listing_item.material_version
      JOIN job_listings listing ON listing.id=listing_item.listing_id
     WHERE item.id=NEW.position_item_id AND item.run_id=NEW.run_id
       AND item.source_position_id=NEW.source_position_id
       AND item.input_hash=NEW.input_hash
       AND item.stage='canonical_resolution' AND item.status='queued'
       AND item.public_job_id IS NULL
       AND json_extract(item.checkpoint_json,'$.identity.state')='derived'
       AND listing_item.stage='completed' AND listing_item.status='completed'
       AND listing_item.listing_id=NEW.listing_id
       AND listing_item.input_hash=version.material_hash
       AND listing.material_version=listing_item.material_version
       AND listing.material_hash=version.material_hash
       AND source_position.source_key=NEW.source_key
       AND source_position.position_key=NEW.position_key
  ) THEN RAISE(ABORT,'duplicate member snapshot changed') END;
END;

CREATE TRIGGER trg_projection_duplicate_member_update_immutable
BEFORE UPDATE ON public_projection_duplicate_batch_members
BEGIN
  SELECT RAISE(ABORT,'duplicate batch members are immutable');
END;

CREATE TRIGGER trg_projection_duplicate_member_delete_immutable
BEFORE DELETE ON public_projection_duplicate_batch_members
BEGIN
  SELECT RAISE(ABORT,'duplicate batch members are append-only');
END;

CREATE TRIGGER trg_projection_duplicate_owner_validate
BEFORE INSERT ON public_projection_duplicate_comparisons
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM public_projection_duplicate_batches batch
     WHERE batch.run_id=NEW.run_id
  ) THEN RAISE(ABORT,'duplicate comparisons are sealed') END;

  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM public_projection_duplicate_work work
     WHERE work.run_id=NEW.run_id AND work.status='processing'
       AND (
         (work.phase='existing_public' AND NEW.target_kind='existing_public')
         OR (work.phase='same_run' AND NEW.target_kind='same_run')
       )
  ) THEN RAISE(ABORT,'duplicate comparison work lease is unavailable') END;

  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM public_projection_duplicate_batch_members member
     JOIN public_projection_position_items item
       ON item.id=member.position_item_id AND item.run_id=member.run_id
     WHERE member.position_item_id=NEW.owner_position_item_id
       AND member.run_id=NEW.run_id
       AND member.source_position_id=NEW.owner_source_position_id
       AND member.input_hash=NEW.owner_input_hash
       AND item.stage='canonical_resolution' AND item.status='queued'
       AND item.public_job_id IS NULL
  ) THEN RAISE(ABORT,'duplicate comparison owner snapshot changed') END;
END;

CREATE TRIGGER trg_projection_duplicate_shadow_target_validate
BEFORE INSERT ON public_projection_duplicate_comparisons
WHEN NEW.target_kind='same_run'
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM public_projection_duplicate_batch_members member
     JOIN public_projection_position_items item
       ON item.id=member.position_item_id AND item.run_id=member.run_id
     WHERE member.position_item_id=NEW.target_position_item_id
       AND member.run_id=NEW.run_id
       AND member.source_position_id=NEW.target_source_position_id
       AND member.input_hash=NEW.target_input_hash
       AND item.stage='canonical_resolution' AND item.status='queued'
       AND item.public_job_id IS NULL
  ) THEN RAISE(ABORT,'duplicate comparison target snapshot changed') END;
END;

CREATE TRIGGER trg_projection_duplicate_public_target_validate
BEFORE INSERT ON public_projection_duplicate_comparisons
WHEN NEW.target_kind='existing_public'
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM public_job_heads head
     WHERE head.public_job_id=NEW.target_public_job_id
       AND head.current_version=NEW.target_public_job_version
  ) THEN RAISE(ABORT,'duplicate comparison public target is not current') END;

  SELECT CASE WHEN NEW.target_redirect_root_id IS NOT (
    WITH RECURSIVE redirect_chain(public_job_id,depth) AS (
      SELECT NEW.target_public_job_id,0
      UNION ALL
      SELECT decision.redirect_public_job_id,redirect_chain.depth+1
        FROM redirect_chain
        JOIN public_job_eligibility_heads head
          ON head.public_job_id=redirect_chain.public_job_id
        JOIN public_job_eligibility_decisions decision
          ON decision.public_job_id=head.public_job_id
         AND decision.decision_version=head.current_decision_version
       WHERE decision.publication_state='merged'
         AND decision.redirect_public_job_id IS NOT NULL
         AND redirect_chain.depth<100
    )
    SELECT redirect_chain.public_job_id FROM redirect_chain
     WHERE NOT EXISTS (
       SELECT 1 FROM public_job_eligibility_heads head
       JOIN public_job_eligibility_decisions decision
         ON decision.public_job_id=head.public_job_id
        AND decision.decision_version=head.current_decision_version
       WHERE head.public_job_id=redirect_chain.public_job_id
         AND decision.publication_state='merged'
         AND decision.redirect_public_job_id IS NOT NULL
     )
     ORDER BY redirect_chain.depth DESC LIMIT 1
  ) THEN RAISE(ABORT,'duplicate comparison public root is not terminal') END;
END;

CREATE TRIGGER trg_projection_duplicate_comparison_update_immutable
BEFORE UPDATE ON public_projection_duplicate_comparisons
BEGIN
  SELECT RAISE(ABORT,'duplicate comparisons are immutable');
END;

CREATE TRIGGER trg_projection_duplicate_comparison_delete_immutable
BEFORE DELETE ON public_projection_duplicate_comparisons
BEGIN
  SELECT RAISE(ABORT,'duplicate comparisons are append-only');
END;

CREATE TRIGGER trg_projection_duplicate_batch_validate
BEFORE INSERT ON public_projection_duplicate_batches
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM public_projection_runs run
     JOIN public_projection_duplicate_work work ON work.run_id=run.id
     WHERE run.id=NEW.run_id AND run.mode='shadow'
       AND run.status='running' AND run.selection_complete=1
       AND work.phase='ready' AND work.status='processing'
       AND work.expected_member_count=NEW.position_member_count
       AND work.member_count=NEW.position_member_count
       AND work.comparison_count=NEW.comparison_count
       AND work.member_digest=NEW.member_digest
       AND work.comparison_digest=NEW.comparison_digest
  ) THEN RAISE(ABORT,'duplicate batch work is not ready') END;

  SELECT CASE WHEN NEW.position_member_count<>(
    SELECT COUNT(*) FROM public_projection_duplicate_batch_members member
     WHERE member.run_id=NEW.run_id
  ) OR NEW.position_member_count<>(
    SELECT COUNT(*) FROM public_projection_position_items item
     WHERE item.run_id=NEW.run_id
       AND item.stage='canonical_resolution' AND item.status='queued'
  ) THEN RAISE(ABORT,'duplicate batch position set is incomplete') END;

  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM public_projection_duplicate_batch_members member
     JOIN public_projection_position_items item
       ON item.id=member.position_item_id AND item.run_id=member.run_id
     JOIN public_projection_listing_items listing_item
       ON listing_item.id=item.listing_item_id
      AND listing_item.run_id=item.run_id
     JOIN job_listing_versions version
       ON version.listing_id=listing_item.listing_id
      AND version.material_version=listing_item.material_version
     JOIN job_listings listing ON listing.id=listing_item.listing_id
     WHERE member.run_id=NEW.run_id
       AND (item.source_position_id<>member.source_position_id
         OR item.input_hash<>member.input_hash
         OR item.stage<>'canonical_resolution' OR item.status<>'queued'
         OR item.public_job_id IS NOT NULL
         OR json_extract(item.checkpoint_json,'$.identity.state')<>'derived'
         OR listing_item.stage<>'completed'
         OR listing_item.status<>'completed'
         OR listing_item.listing_id<>member.listing_id
         OR listing_item.input_hash<>version.material_hash
         OR listing.material_version<>listing_item.material_version
         OR listing.material_hash<>version.material_hash)
  ) THEN RAISE(ABORT,'duplicate batch member snapshot changed') END;

  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM public_projection_position_items item
     WHERE item.run_id=NEW.run_id
       AND item.stage='canonical_resolution' AND item.status='queued'
       AND NOT EXISTS (
         SELECT 1 FROM public_projection_duplicate_batch_members member
          WHERE member.run_id=NEW.run_id
            AND member.position_item_id=item.id
       )
  ) THEN RAISE(ABORT,'duplicate batch position set omits a member') END;

  SELECT CASE WHEN NEW.comparison_count<>(
    SELECT COUNT(*) FROM public_projection_duplicate_comparisons comparison
     WHERE comparison.run_id=NEW.run_id
  ) THEN RAISE(ABORT,'duplicate batch comparison set is incomplete') END;
END;

CREATE TRIGGER trg_projection_duplicate_batch_update_immutable
BEFORE UPDATE ON public_projection_duplicate_batches
BEGIN
  SELECT RAISE(ABORT,'duplicate batches are immutable');
END;

CREATE TRIGGER trg_projection_duplicate_batch_delete_immutable
BEFORE DELETE ON public_projection_duplicate_batches
BEGIN
  SELECT RAISE(ABORT,'duplicate batches are append-only');
END;

CREATE TRIGGER trg_projection_position_insert_after_duplicate_seal
BEFORE INSERT ON public_projection_position_items
WHEN EXISTS (
  SELECT 1 FROM public_projection_duplicate_batches batch
   WHERE batch.run_id=NEW.run_id
)
BEGIN
  SELECT RAISE(ABORT,'projection duplicate position set is sealed');
END;
