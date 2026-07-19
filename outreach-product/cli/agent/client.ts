import { z } from "zod";
import type { AgentConfig } from "./config";

const TRAILING_SLASH_PATTERN = /\/$/u;

export class JobKitAgentApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export interface JobKitAgentClient {
  post: (
    path: string,
    body: Record<string, unknown>
  ) => Promise<Record<string, unknown>>;
}

export function createAgentClient(config: AgentConfig): JobKitAgentClient {
  const baseUrl = config.baseUrl.replace(TRAILING_SLASH_PATTERN, "");
  return {
    async post(path, body) {
      const response = await fetch(`${baseUrl}${path}`, {
        body: JSON.stringify(body),
        headers: {
          authorization: `Bearer ${config.token}`,
          "content-type": "application/json",
        },
        method: "POST",
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        const parsed = z.object({ message: z.string() }).safeParse(payload);
        throw new JobKitAgentApiError(
          parsed.success ? parsed.data.message : "Unexpected JobKit response",
          response.status
        );
      }
      return z.record(z.string(), z.unknown()).parse(payload);
    },
  };
}
