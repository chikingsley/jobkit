import type { OpenAPIHono } from "@hono/zod-openapi";
import type { AgentCapability } from "../src/features/agents/schema";
import type { AppEnv } from "./env";

export interface AuthUser {
  email: string;
  id: string;
  name: string;
  role: "member" | "operator";
}

export interface AgentRunnerContext {
  capabilities: AgentCapability[];
  codexVersion: string;
  id: string;
  name: string;
  user: AuthUser;
}

export type JobKitApp = OpenAPIHono<{
  Bindings: AppEnv;
  Variables: { agentRunner: AgentRunnerContext | null; user: AuthUser };
}>;
