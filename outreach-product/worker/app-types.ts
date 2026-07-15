import type { OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "./env";

export interface AuthUser {
  email: string;
  id: string;
  name: string;
}

export type JobKitApp = OpenAPIHono<{
  Bindings: AppEnv;
  Variables: { user: AuthUser };
}>;
