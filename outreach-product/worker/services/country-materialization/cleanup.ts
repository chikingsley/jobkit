import type { AppEnv } from "../../env";

export const ABANDONED_OUTPUT_RETENTION_DAYS = 7;
export const R2_CLEANUP_LIST_LIMIT = 100;
const CLEANUP_SEED_LIMIT = 10;

interface CleanupCandidateRow {
  output_id: string;
}

export async function cleanupAbandonedCountrySweepOutputObjects(
  env: Pick<AppEnv, "DB" | "SWEEP_OUTPUTS">,
  now = new Date()
) {
  const cutoff = new Date(
    now.getTime() - ABANDONED_OUTPUT_RETENTION_DAYS * 24 * 60 * 60 * 1000
  );
  const timestamp = now.toISOString();
  await env.DB.prepare(
    `INSERT INTO country_sweep_output_cleanup
      (output_id,status,created_at,updated_at)
     SELECT output.id,'pending',?,?
       FROM country_sweep_outputs output
      WHERE output.status='abandoned' AND output.updated_at<=?
        AND NOT EXISTS (
          SELECT 1 FROM country_sweep_output_cleanup cleanup
           WHERE cleanup.output_id=output.id
        )
      ORDER BY output.updated_at,output.id LIMIT ?`
  )
    .bind(timestamp, timestamp, cutoff.toISOString(), CLEANUP_SEED_LIMIT)
    .run();

  const candidate = await env.DB.prepare(
    `SELECT cleanup.output_id
       FROM country_sweep_output_cleanup cleanup
       JOIN country_sweep_outputs output ON output.id=cleanup.output_id
      WHERE cleanup.status='pending' AND output.status='abandoned'
        AND output.updated_at<=?
      ORDER BY cleanup.updated_at,cleanup.output_id LIMIT 1`
  )
    .bind(cutoff.toISOString())
    .first<CleanupCandidateRow>();
  if (!candidate) {
    return { completed: 0, deleted: 0, listed: 0, outputId: null };
  }

  const listed = await env.SWEEP_OUTPUTS.list({
    limit: R2_CLEANUP_LIST_LIMIT,
    prefix: countrySweepOutputObjectPrefix(candidate.output_id),
  });
  const oldKeys = listed.objects
    .filter((object) => object.uploaded <= cutoff)
    .map((object) => object.key);
  if (oldKeys.length > 0) {
    await env.SWEEP_OUTPUTS.delete(oldKeys);
  }
  const completed =
    !listed.truncated && oldKeys.length === listed.objects.length;
  await env.DB.prepare(
    `UPDATE country_sweep_output_cleanup
        SET status=?,deleted_object_count=deleted_object_count+?,
            completed_at=CASE WHEN ?=1 THEN ? ELSE NULL END,updated_at=?
      WHERE output_id=? AND status='pending'`
  )
    .bind(
      completed ? "completed" : "pending",
      oldKeys.length,
      completed ? 1 : 0,
      timestamp,
      timestamp,
      candidate.output_id
    )
    .run();
  return {
    completed: completed ? 1 : 0,
    deleted: oldKeys.length,
    listed: listed.objects.length,
    outputId: candidate.output_id,
  };
}

function countrySweepOutputObjectPrefix(outputId: string) {
  return `country-sweeps/${outputId}/`;
}
