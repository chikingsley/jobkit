import { existsSync } from "node:fs";
import path from "node:path";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const LOCAL_BUILD_SECRETS_PATH = path.resolve(
  import.meta.dirname,
  "dist/jobkit_outreach/.dev.vars"
);

function rejectLocalSecretsInBuild(): Plugin {
  return {
    apply: "build",
    closeBundle() {
      if (existsSync(LOCAL_BUILD_SECRETS_PATH)) {
        throw new Error(
          "Production build contains local development secrets at dist/jobkit_outreach/.dev.vars"
        );
      }
    },
    name: "jobkit-reject-local-build-secrets",
  };
}

export default defineConfig(({ command }) => ({
  plugins: [
    react(),
    tailwindcss(),
    cloudflare(
      command === "build"
        ? {
            // The Cloudflare Vite plugin otherwise serializes local development
            // secrets into dist for `vite preview`. Production builds never need
            // that preview-only file.
            config: { secrets: { required: [] } },
          }
        : undefined
    ),
    rejectLocalSecretsInBuild(),
  ],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "./src") } },
}));
