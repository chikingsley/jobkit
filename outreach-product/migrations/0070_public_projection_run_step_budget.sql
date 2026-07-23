-- Hard step budget for the self-chaining projection queue. Every chained
-- consumer step for a run increments this counter; crossing the ceiling
-- terminalizes the run instead of sustaining an unbounded hot loop.
ALTER TABLE public_projection_runs
  ADD COLUMN advance_step_count INTEGER NOT NULL DEFAULT 0
    CHECK (advance_step_count>=0);

CREATE TRIGGER trg_public_projection_run_step_budget_guard
BEFORE UPDATE ON public_projection_runs
BEGIN
  SELECT RAISE(ABORT,'projection run step count cannot move backward')
   WHERE NEW.advance_step_count<OLD.advance_step_count;
  SELECT RAISE(ABORT,'terminal projection run is immutable')
   WHERE OLD.status IN ('completed','completed_with_blocks','failed','canceled')
     AND NEW.advance_step_count IS NOT OLD.advance_step_count;
END;
