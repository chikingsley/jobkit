import type { AppEnv } from "../env";
import {
  type AgentTaskMaintenanceQueueMessage,
  AgentTaskMaintenanceQueueMessageSchema,
  consumeAgentTaskMaintenanceQueue,
} from "./agent-task-maintenance-queue";
import {
  type CountryMaterializationQueueMessage,
  CountryMaterializationQueueMessageSchema,
  consumeCountryMaterializationQueue,
} from "./country-materialization/queue";
import {
  consumePublicProjectionQueue,
  type PublicProjectionQueueMessage,
} from "./public-projection/queue";

export type JobKitQueueMessage =
  | AgentTaskMaintenanceQueueMessage
  | CountryMaterializationQueueMessage
  | PublicProjectionQueueMessage;

export function consumeJobKitQueue(
  batch: MessageBatch<JobKitQueueMessage>,
  env: AppEnv
) {
  const [message] = batch.messages;
  if (
    message &&
    AgentTaskMaintenanceQueueMessageSchema.safeParse(message.body).success
  ) {
    return consumeAgentTaskMaintenanceQueue(
      batch as MessageBatch<AgentTaskMaintenanceQueueMessage>,
      env
    );
  }
  if (
    message &&
    CountryMaterializationQueueMessageSchema.safeParse(message.body).success
  ) {
    return consumeCountryMaterializationQueue(
      batch as MessageBatch<CountryMaterializationQueueMessage>,
      env
    );
  }
  return consumePublicProjectionQueue(
    batch as MessageBatch<PublicProjectionQueueMessage>,
    env
  );
}
