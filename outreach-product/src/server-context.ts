import type { AppEnv } from "../worker/env";

export interface JobKitStartRequestContext {
  env: AppEnv;
  executionContext: ExecutionContext;
  request: Request;
}

export interface JobKitStartRegister {
  server: {
    requestContext: JobKitStartRequestContext;
  };
}

declare module "@tanstack/router-core" {
  interface Register {
    server: {
      requestContext: JobKitStartRequestContext;
    };
  }
}
