export interface AppEnv extends Env {
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_PUBSUB_AUDIENCE?: string;
  GOOGLE_PUBSUB_SERVICE_ACCOUNT?: string;
  GOOGLE_PUBSUB_TOPIC?: string;
  JINA_API_KEY?: string;
  MAPBOX_ACCESS_TOKEN?: string;
  SERIOUSTEACHERS_EMAIL?: string;
  SERIOUSTEACHERS_PASSWORD?: string;
}
