import path from "node:path";
import {
  cloudflareTest,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const migrations = await readD1Migrations("./migrations");

export default defineConfig({
  plugins: [
    cloudflareTest({
      main: "./src/server.ts",
      miniflare: {
        bindings: {
          APP_ORIGIN: "https://outreach.test",
          BETTER_AUTH_SECRET: "integration-test-secret-at-least-32-characters",
          PUBLIC_JOB_CURSOR_SECRET: "public-start-integration-secret",
          TEST_MIGRATIONS: migrations,
        },
      },
      wrangler: { configPath: "./wrangler.jsonc" },
    }),
    tanstackStart(),
    react(),
  ],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "../src") } },
  test: {
    include: ["tests/integration/start/**/*.test.ts"],
    testTimeout: 30_000,
  },
});
