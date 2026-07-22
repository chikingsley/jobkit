import type { AgentTaskMaintenanceQueueMessage } from "./services/agent-task-maintenance-queue";
import type { CountryMaterializationQueueMessage } from "./services/country-materialization/queue";
import type { PublicProjectionQueueMessage } from "./services/public-projection/queue";

export interface AppEnv extends Env {
  AGENT_MAINTENANCE_QUEUE: Queue<AgentTaskMaintenanceQueueMessage>;
  COUNTRY_MATERIALIZATION_QUEUE: Queue<CountryMaterializationQueueMessage>;
  FX_RATES_JSON?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_PUBSUB_AUDIENCE?: string;
  GOOGLE_PUBSUB_SERVICE_ACCOUNT?: string;
  GOOGLE_PUBSUB_TOPIC?: string;
  JINA_API_KEY?: string;
  MAPBOX_ACCESS_TOKEN?: string;
  PUBLIC_JOB_CURSOR_SECRET?: string;
  PUBLIC_PROJECTION_QUEUE: Queue<PublicProjectionQueueMessage>;
  SERIOUSTEACHERS_EMAIL?: string;
  SERIOUSTEACHERS_PASSWORD?: string;
  SWEEP_OUTPUTS: R2Bucket;
}
