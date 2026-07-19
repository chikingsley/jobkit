import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";

export const agentConfigPath = resolve(
  import.meta.dir,
  "../../.jobkit/agent.json"
);

const AgentConfigSchema = z
  .object({
    baseUrl: z.url(),
    runnerId: z.string().min(1),
    token: z.string().startsWith("jobkit_agent_"),
  })
  .strict();

export type AgentConfig = z.infer<typeof AgentConfigSchema>;

export async function readAgentConfig() {
  const contents = await readFile(agentConfigPath, "utf8");
  return AgentConfigSchema.parse(JSON.parse(contents));
}
