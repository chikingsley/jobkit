DROP TRIGGER trg_public_projection_listing_update_guard;

UPDATE public_projection_listing_items
   SET attempt_count=0,
       updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE status='queued'
   AND attempt_count>=max_attempts;

CREATE TRIGGER trg_public_projection_listing_update_guard
BEFORE UPDATE ON public_projection_listing_items
BEGIN
  SELECT CASE WHEN
    OLD.status IN ('completed','superseded')
    AND (
      NEW.stage IS NOT OLD.stage
      OR NEW.status IS NOT OLD.status
      OR NEW.attempt_count IS NOT OLD.attempt_count
      OR NEW.lease_owner IS NOT OLD.lease_owner
      OR NEW.lease_token IS NOT OLD.lease_token
      OR NEW.lease_expires_at IS NOT OLD.lease_expires_at
      OR NEW.checkpoint_json IS NOT OLD.checkpoint_json
      OR NEW.error_code IS NOT OLD.error_code
      OR NEW.error_detail IS NOT OLD.error_detail
      OR NEW.started_at IS NOT OLD.started_at
      OR NEW.completed_at IS NOT OLD.completed_at
      OR NEW.updated_at IS NOT OLD.updated_at
    )
  THEN RAISE(ABORT,'terminal projection listing is immutable') END;

  SELECT CASE WHEN
    NEW.id IS NOT OLD.id
    OR NEW.run_id IS NOT OLD.run_id
    OR NEW.listing_id IS NOT OLD.listing_id
    OR NEW.material_version IS NOT OLD.material_version
    OR NEW.input_hash IS NOT OLD.input_hash
    OR NEW.max_attempts IS NOT OLD.max_attempts
    OR NEW.created_at IS NOT OLD.created_at
  THEN RAISE(ABORT,'projection listing input snapshot is immutable') END;

  SELECT CASE WHEN NEW.stage<>OLD.stage AND NOT (
    (OLD.stage='selected' AND NEW.stage='prerequisites')
    OR (OLD.stage='prerequisites' AND NEW.stage='source_positions')
    OR (OLD.stage='source_positions' AND NEW.stage='completed')
  ) THEN RAISE(ABORT,'invalid projection listing stage transition') END;

  SELECT CASE WHEN NEW.status<>OLD.status AND NOT (
    (OLD.status='queued' AND NEW.status IN ('processing','superseded'))
    OR (OLD.status='processing' AND NEW.status IN (
      'queued','waiting_analysis','blocked','completed','failed','superseded'
    ))
    OR (OLD.status='waiting_analysis' AND NEW.status IN (
      'queued','processing','blocked','failed','superseded'
    ))
    OR (OLD.status IN ('blocked','failed') AND NEW.status IN (
      'queued','superseded'
    ))
  ) THEN RAISE(ABORT,'invalid projection listing status transition') END;

  SELECT CASE WHEN
    OLD.status<>'processing'
    AND NEW.status='processing'
    AND NEW.attempt_count<>OLD.attempt_count+1
  THEN RAISE(ABORT,'projection listing claim must advance attempt') END;

  SELECT CASE WHEN NOT (
    (OLD.status<>'processing' AND NEW.status='processing')
    OR (
      OLD.status IN ('processing','waiting_analysis')
      AND NEW.status='queued'
      AND NEW.attempt_count=0
    )
    OR (
      OLD.status='queued'
      AND NEW.status='queued'
      AND OLD.attempt_count>=OLD.max_attempts
      AND NEW.attempt_count=0
    )
  ) AND NEW.attempt_count<>OLD.attempt_count
  THEN RAISE(ABORT,'projection listing attempt changes require a claim') END;

  SELECT CASE WHEN
    OLD.status='processing'
    AND NEW.status='processing'
    AND (
      NEW.lease_owner IS NOT OLD.lease_owner
      OR NEW.lease_token IS NOT OLD.lease_token
    )
  THEN RAISE(ABORT,'projection listing lease ownership is immutable') END;
end;
