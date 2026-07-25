import type { AgentCapability } from "./schema";

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
