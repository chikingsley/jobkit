import { PUBLIC_JOB_ALLOCATION_VERSION } from "./model";

export function publicRootPinAssertion(db: D1Database, runId: string) {
  return db
    .prepare(
      `INSERT INTO public_projection_final_assertions (
        expected_changes,actual_changes
      )
      WITH RECURSIVE
      requested(originating_public_job_id) AS (
        SELECT originating_public_job_id
          FROM public_projection_final_work_public_roots
         WHERE run_id=?
      ),
      redirect_chain(
        originating_public_job_id,public_job_id,depth,path,path_json
      ) AS (
        SELECT requested.originating_public_job_id,
               requested.originating_public_job_id,0,
               '|' || requested.originating_public_job_id || '|',
               json_array(requested.originating_public_job_id)
          FROM requested
        UNION ALL
        SELECT chain.originating_public_job_id,
               decision.redirect_public_job_id,chain.depth+1,
               chain.path || decision.redirect_public_job_id || '|',
               json_insert(
                 chain.path_json,'$[#]',decision.redirect_public_job_id
               )
          FROM redirect_chain chain
          JOIN public_job_eligibility_heads head
            ON head.public_job_id=chain.public_job_id
          JOIN public_job_eligibility_decisions decision
            ON decision.public_job_id=head.public_job_id
           AND decision.decision_version=head.current_decision_version
         WHERE decision.publication_state='merged'
           AND decision.redirect_public_job_id IS NOT NULL
           AND chain.depth<100
           AND instr(
             chain.path,'|' || decision.redirect_public_job_id || '|'
           )=0
      ),
      terminal AS (
        SELECT chain.*,
               ROW_NUMBER() OVER (
                 PARTITION BY chain.originating_public_job_id
                 ORDER BY chain.depth DESC
               ) terminal_rank
          FROM redirect_chain chain
         WHERE NOT EXISTS (
           SELECT 1 FROM public_job_eligibility_heads head
           JOIN public_job_eligibility_decisions decision
             ON decision.public_job_id=head.public_job_id
            AND decision.decision_version=head.current_decision_version
            WHERE head.public_job_id=chain.public_job_id
              AND decision.publication_state='merged'
              AND decision.redirect_public_job_id IS NOT NULL
         )
      ),
      matching AS (
        SELECT work.originating_public_job_id
          FROM terminal
          JOIN public_projection_final_work_public_roots work
            ON work.run_id=?
           AND work.originating_public_job_id=
               terminal.originating_public_job_id
           AND work.redirect_root_id=terminal.public_job_id
           AND work.redirect_path_json=terminal.path_json
          JOIN public_jobs public_job ON public_job.id=terminal.public_job_id
          JOIN public_job_heads job_head
            ON job_head.public_job_id=terminal.public_job_id
           AND job_head.current_version=work.public_job_version
          JOIN public_job_eligibility_heads eligibility_head
            ON eligibility_head.public_job_id=terminal.public_job_id
           AND eligibility_head.current_decision_version=
               work.eligibility_decision_version
          LEFT JOIN public_job_allocations allocation
            ON allocation.public_job_id=terminal.public_job_id
         WHERE terminal.terminal_rank=1
           AND work.public_job_created_at=public_job.created_at
           AND work.served_publicly=(
             CASE WHEN EXISTS (
               SELECT 1 FROM public_job_eligibility_decisions history
                WHERE history.public_job_id=terminal.public_job_id
                  AND history.publication_state='published'
                  AND history.route_disposition='serve'
             ) THEN 1 ELSE 0 END
           )
           AND work.first_published_at IS (
             SELECT MIN(history.decided_at)
               FROM public_job_eligibility_decisions history
              WHERE history.public_job_id=terminal.public_job_id
                AND history.publication_state='published'
                AND history.route_disposition='serve'
           )
           AND work.founding_source_position_id IS
               allocation.founding_source_position_id
           AND work.allocation_hash IS allocation.allocation_hash
      )
      SELECT (
        SELECT COUNT(*)
          FROM public_projection_final_work_public_roots
         WHERE run_id=?
      ),(
        SELECT COUNT(*) FROM matching
      )`
    )
    .bind(runId, runId, runId);
}

export function operatorDecisionPinAssertion(db: D1Database, runId: string) {
  return db
    .prepare(
      `INSERT INTO public_projection_final_assertions (
        expected_changes,actual_changes
      ) VALUES ((
        SELECT COUNT(*) FROM public_projection_final_work_relations
         WHERE run_id=?
      ),(
        SELECT COUNT(*) FROM public_projection_final_work_relations work
         WHERE work.run_id=? AND work.operator_terminal=1 AND (
           (
             work.operator_decision_id IS NULL
             AND (
               work.relation<>'ambiguous' OR NOT EXISTS (
                 SELECT 1
                   FROM public_projection_duplicate_operator_decisions decision
                  WHERE decision.left_member_key=work.left_member_key
                    AND decision.right_member_key=work.right_member_key
                    AND NOT EXISTS (
                      SELECT 1
                        FROM public_projection_duplicate_operator_decisions next
                       WHERE next.supersedes_decision_id=decision.id
                    )
               )
             )
           )
           OR EXISTS (
             SELECT 1
               FROM public_projection_duplicate_operator_decisions decision
              WHERE decision.id=work.operator_decision_id
                AND decision.left_member_key=work.left_member_key
                AND decision.right_member_key=work.right_member_key
                AND decision.decision_hash=work.operator_decision_hash
                AND NOT EXISTS (
                  SELECT 1
                    FROM public_projection_duplicate_operator_decisions next
                   WHERE next.supersedes_decision_id=decision.id
                )
           )
         )
      ))`
    )
    .bind(runId, runId);
}

export function proposedIdCollisionPinAssertion(db: D1Database, runId: string) {
  return db
    .prepare(
      `INSERT INTO public_projection_final_assertions (
        expected_changes,actual_changes
      ) SELECT COUNT(*),COALESCE(SUM(CASE WHEN
          component.proposed_public_job_id IS NULL
          OR (
            component.reason_code='new_public_entity'
            AND (
              NOT EXISTS (
                SELECT 1 FROM public_jobs public_job
                 WHERE public_job.id=component.proposed_public_job_id
              )
              OR EXISTS (
                SELECT 1 FROM public_job_allocations allocation
                 WHERE allocation.public_job_id=
                         component.proposed_public_job_id
                   AND allocation.allocation_algorithm_version=?
                   AND allocation.founding_source_position_id=
                         component.founding_source_position_id
                   AND allocation.allocation_hash=component.allocation_hash
              )
            )
          )
          OR (
            component.reason_code='public_job_id_collision'
            AND EXISTS (
              SELECT 1 FROM public_jobs public_job
               WHERE public_job.id=component.proposed_public_job_id
            )
            AND NOT EXISTS (
              SELECT 1 FROM public_job_allocations allocation
               WHERE allocation.public_job_id=component.proposed_public_job_id
                 AND allocation.allocation_algorithm_version=?
                 AND allocation.founding_source_position_id=
                       component.founding_source_position_id
                 AND allocation.allocation_hash=component.allocation_hash
            )
          )
        THEN 1 ELSE 0 END),0)
        FROM public_projection_final_component_work component
       WHERE component.run_id=? AND component.state='sealed'`
    )
    .bind(PUBLIC_JOB_ALLOCATION_VERSION, PUBLIC_JOB_ALLOCATION_VERSION, runId);
}

export function assertionStatement(db: D1Database, expectedChanges: number) {
  return db
    .prepare(
      `INSERT INTO public_projection_final_assertions (
        expected_changes,actual_changes
      ) VALUES (?,changes())`
    )
    .bind(expectedChanges);
}
