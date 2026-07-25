import { z } from "zod";
import type { AgentConfig } from "./config";

const TRAILING_SLASH_PATTERN = /\/$/u;

export class JobKitAgentApiError extends Error {
  readonly rejectedEvidence: string[];
  readonly status: number;

  constructor(
    message: string,
    status: number,
    rejectedEvidence: string[] = []
  ) {
    super(message);
    this.rejectedEvidence = rejectedEvidence;
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
        const parsed = z
          .object({
            message: z.string(),
            rejectedEvidence: z.array(z.string()).optional(),
          })
          .safeParse(payload);
        throw new JobKitAgentApiError(
          parsed.success
            ? `${parsed.data.message}${
                parsed.data.rejectedEvidence?.length
                  ? `: ${JSON.stringify(parsed.data.rejectedEvidence)}`
                  : ""
              }`
            : "Unexpected JobKit response",
          response.status,
          parsed.success ? parsed.data.rejectedEvidence : undefined
        );
      }
      return z.record(z.string(), z.unknown()).parse(payload);
    },
  };
}
