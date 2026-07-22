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

// TanStack Start's server-function types resolve Register from router-core in
// the installed package graph. Keep the request context visible to those
// handlers as well as to the explicitly typed Start fetch handler.
declare module "@tanstack/router-core" {
  interface Register {
    server: {
      requestContext: JobKitStartRequestContext;
    };
  }
}
