import { z } from "zod";
import type { AppEnv } from "../../env";
import { advancePublicProjectionRuns } from "./advancement";
import { finalizeCanonicalDuplicateGraph } from "./final-graph";
import { createMapboxPermanentLocationResolver } from "./mapbox-location-resolver";

const PublicProjectionQueueMessageSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("advance_public_projection"),
    version: z.literal(1),
  }),
  z.object({
    kind: z.literal("final_duplicate_page"),
    runId: z.string().min(1),
    version: z.literal(1),
  }),
]);

export type PublicProjectionQueueMessage = z.infer<
  typeof PublicProjectionQueueMessageSchema
>;

const ADVANCE_MESSAGE = {
  kind: "advance_public_projection",
  version: 1,
} as const satisfies PublicProjectionQueueMessage;

export function queuePublicProjectionAdvance(env: AppEnv) {
  return env.PUBLIC_PROJECTION_QUEUE.send(ADVANCE_MESSAGE);
}

export function queueFinalDuplicatePage(env: AppEnv, runId: string) {
  return env.PUBLIC_PROJECTION_QUEUE.send({
    kind: "final_duplicate_page",
    runId,
    version: 1,
  } satisfies PublicProjectionQueueMessage);
}

export async function consumePublicProjectionQueue(
  batch: MessageBatch<PublicProjectionQueueMessage>,
  env: AppEnv
) {
  for (const message of batch.messages) {
    // biome-ignore lint/performance/noAwaitInLoops: Queue delivery is configured serially and every message owns one D1 invocation budget.
    await consumePublicProjectionMessage(message, env);
  }
}

async function consumePublicProjectionMessage(
  message: Message<PublicProjectionQueueMessage>,
  env: AppEnv
) {
  const parsed = PublicProjectionQueueMessageSchema.safeParse(message.body);
  if (!parsed.success) {
    console.error(
      JSON.stringify({
        event: "public_projection_queue_message_rejected",
        messageId: message.id,
      })
    );
    message.ack();
    return;
  }

  try {
    if (parsed.data.kind === "final_duplicate_page") {
      const finalGraph = await finalizeCanonicalDuplicateGraph(
        env.DB,
        parsed.data.runId,
        new Date().toISOString()
      );
      const nextMessage: PublicProjectionQueueMessage =
        finalGraph.state === "pending"
          ? {
              kind: "final_duplicate_page",
              runId: parsed.data.runId,
              version: 1,
            }
          : ADVANCE_MESSAGE;
      await env.PUBLIC_PROJECTION_QUEUE.send(nextMessage, {
        delaySeconds: 0,
      });
      message.ack();
      console.log(
        JSON.stringify({
          event: "public_projection_final_duplicate_page",
          finalGraph,
          messageId: message.id,
          runId: parsed.data.runId,
        })
      );
      return;
    }
    const projection = await advancePublicProjectionRuns(env.DB, {
      deferFinalDuplicate: true,
      locationResolver: createMapboxPermanentLocationResolver(
        env.MAPBOX_ACCESS_TOKEN
      ),
    });
    if (projection.runId !== null) {
      const nextMessage: PublicProjectionQueueMessage =
        "finalDuplicateState" in projection &&
        projection.finalDuplicateState === "pending"
          ? {
              kind: "final_duplicate_page",
              runId: projection.runId,
              version: 1,
            }
          : ADVANCE_MESSAGE;
      await env.PUBLIC_PROJECTION_QUEUE.send(nextMessage, {
        delaySeconds: 0,
      });
    }
    message.ack();
    console.log(
      JSON.stringify({
        event: "public_projection_advanced",
        messageId: message.id,
        projection,
      })
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
        event: "public_projection_advance_failed",
        messageId: message.id,
      })
    );
    message.retry();
  }
}
