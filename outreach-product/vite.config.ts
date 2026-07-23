import { existsSync } from "node:fs";
import path from "node:path";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const LOCAL_BUILD_SECRETS_PATHS = [
  "dist/client/.dev.vars",
  "dist/server/.dev.vars",
].map((relativePath) => path.resolve(import.meta.dirname, relativePath));

function rejectLocalSecretsInBuild(): Plugin {
  return {
    apply: "build",
    closeBundle() {
      if (
        LOCAL_BUILD_SECRETS_PATHS.some((secretPath) => existsSync(secretPath))
      ) {
        throw new Error(
          "Production build contains a local .dev.vars file in its client or server output"
        );
      }
    },
    name: "jobkit-reject-local-build-secrets",
  };
}

export default defineConfig(({ command }) => {
  const persistencePath = process.env.JOBKIT_PERSIST_STATE;
  return {
    plugins: [
      cloudflare({
        ...(command === "build"
          ? {
              // Local preview secrets belong outside production output.
              config: { secrets: { required: [] } },
            }
          : {}),
        ...(persistencePath
          ? { persistState: { path: path.resolve(persistencePath) } }
          : {}),
        viteEnvironment: { name: "ssr" },
      }),
      tanstackStart(),
      react(),
      tailwindcss(),
      rejectLocalSecretsInBuild(),
    ],
    resolve: { alias: { "@": path.resolve(import.meta.dirname, "./src") } },
  };
});
