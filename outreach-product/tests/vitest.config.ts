import {
  cloudflareTest,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

const migrations = await readD1Migrations("./migrations");

export default defineConfig({
  plugins: [
    cloudflareTest({
      miniflare: {
        bindings: {
          APP_ORIGIN: "https://outreach.test",
          BETTER_AUTH_SECRET: "integration-test-secret-at-least-32-characters",
          GOOGLE_CLIENT_ID: "test-google-client-id",
          GOOGLE_CLIENT_SECRET: "test-google-client-secret",
          GOOGLE_PUBSUB_AUDIENCE:
            "https://outreach.test/api/webhooks/google/gmail",
          GOOGLE_PUBSUB_SERVICE_ACCOUNT: "pubsub@example.test",
          GOOGLE_PUBSUB_TOPIC: "projects/test-project/topics/jobkit-gmail",
          JINA_API_KEY: "test-jina-key",
          SERIOUSTEACHERS_EMAIL: "teacher@example.test",
          SERIOUSTEACHERS_PASSWORD: "test-password",
          TEST_MIGRATIONS: migrations,
        },
      },
      wrangler: { configPath: "./wrangler.jsonc" },
    }),
  ],
  test: {
    include: ["tests/integration/worker/**/*.test.ts"],
  },
});
