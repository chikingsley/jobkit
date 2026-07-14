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
