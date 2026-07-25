import { z } from "zod";
import type { AppEnv } from "../env";
import { reapAgentTasks } from "./agent-task-broker";

export const AgentTaskMaintenanceQueueMessageSchema = z.object({
  kind: z.literal("reap_agent_tasks"),
  version: z.literal(1),
});

export type AgentTaskMaintenanceQueueMessage = z.infer<
  typeof AgentTaskMaintenanceQueueMessageSchema
>;

const REAP_MESSAGE = {
  kind: "reap_agent_tasks",
  version: 1,
} as const satisfies AgentTaskMaintenanceQueueMessage;

export function queueAgentTaskMaintenance(env: AppEnv) {
  return env.AGENT_MAINTENANCE_QUEUE.send(REAP_MESSAGE);
}

export async function consumeAgentTaskMaintenanceQueue(
  batch: MessageBatch<AgentTaskMaintenanceQueueMessage>,
  env: AppEnv
) {
  for (const message of batch.messages) {
    const parsed = AgentTaskMaintenanceQueueMessageSchema.safeParse(
      message.body
    );
    if (!parsed.success) {
      console.error(
        JSON.stringify({
          event: "agent_task_maintenance_message_rejected",
          messageId: message.id,
        })
      );
      message.ack();
      continue;
    }

    try {
      // biome-ignore lint/performance/noAwaitInLoops: Queue delivery is deliberately sequential.
      const result = await reapAgentTasks(env);
      if (result.selected > 0) {
        await env.AGENT_MAINTENANCE_QUEUE.send(REAP_MESSAGE, {
          delaySeconds: 1,
        });
      }
      message.ack();
      console.log(
        JSON.stringify({
          event: "agent_tasks_reaped",
          messageId: message.id,
          result,
        })
      );
    } catch (error) {
      console.error(
        JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
          event: "agent_task_maintenance_failed",
          messageId: message.id,
        })
      );
      message.retry();
    }
  }
}
