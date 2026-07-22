import { z } from "zod";
import type { AppEnv } from "../../env";
import { materializeOneCountrySweepItem } from "./materializer";
import { MATERIALIZATION_TOPIC } from "./output";

export const CountryMaterializationQueueMessageSchema = z
  .object({
    aggregateId: z.string().min(1),
    kind: z.literal("country_sweep_materialization"),
    version: z.literal(1),
    workItemId: z.string().min(1),
  })
  .strict();

export type CountryMaterializationQueueMessage = z.infer<
  typeof CountryMaterializationQueueMessageSchema
>;

interface CountryOutboxRow {
  aggregate_id: string;
  id: string;
  work_item_id: string;
}

export async function publishCountryMaterializationOutbox(env: AppEnv) {
  const row = await env.DB.prepare(
    `SELECT id,aggregate_id,work_item_id FROM work_outbox
      WHERE topic=? AND published_at IS NULL
        AND trim(work_item_id)<>''
        AND available_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')
      ORDER BY available_at,id LIMIT 1`
  )
    .bind(MATERIALIZATION_TOPIC)
    .first<CountryOutboxRow>();
  if (!row) {
    return { published: 0 };
  }
  const message = {
    aggregateId: row.aggregate_id,
    kind: "country_sweep_materialization",
    version: 1,
    workItemId: row.work_item_id,
  } as const satisfies CountryMaterializationQueueMessage;
  await env.COUNTRY_MATERIALIZATION_QUEUE.send(message);
  const result = await env.DB.prepare(
    `UPDATE work_outbox
        SET published_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
            publish_attempt_count=publish_attempt_count+1
      WHERE id=? AND topic=? AND aggregate_id=? AND published_at IS NULL`
  )
    .bind(row.id, MATERIALIZATION_TOPIC, row.aggregate_id)
    .run();
  return { published: result.meta.changes ?? 0 };
}

export async function consumeCountryMaterializationQueue(
  batch: MessageBatch<CountryMaterializationQueueMessage>,
  env: AppEnv
) {
  for (const message of batch.messages) {
    const parsed = CountryMaterializationQueueMessageSchema.safeParse(
      message.body
    );
    if (!parsed.success) {
      console.error(
        JSON.stringify({
          event: "country_materialization_queue_message_rejected",
          messageId: message.id,
        })
      );
      message.ack();
      continue;
    }
    try {
      // biome-ignore lint/performance/noAwaitInLoops: Each Queue delivery owns exactly one bounded materialization item.
      const result = await materializeOneCountrySweepItem(
        env,
        parsed.data.aggregateId,
        `queue:${message.id}`,
        parsed.data.workItemId
      );
      // A committed item creates the next durable outbox wake-up. Publishing
      // one row here reduces latency; the scheduled dispatcher remains the
      // recovery path when a send or acknowledgement is interrupted.
      const outbox = await publishCountryMaterializationOutbox(env);
      message.ack();
      console.log(
        JSON.stringify({
          event: "country_materialization_advanced",
          messageId: message.id,
          outbox,
          result,
          workItemId: parsed.data.workItemId,
        })
      );
    } catch (error) {
      console.error(
        JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
          event: "country_materialization_failed",
          messageId: message.id,
          workItemId: parsed.data.workItemId,
        })
      );
      message.retry();
    }
  }
}
