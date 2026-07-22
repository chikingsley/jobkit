import { AgentTaskError } from "./contracts";

// A canonical country chunk is capped at 1,000,000 bytes. The remaining
// 100,000 bytes cover its lease, digest, counters, and JSON envelope. The same
// bound keeps the legacy small-output completion path available without
// restoring an unbounded in-memory request parser.
export const MAX_AGENT_TASK_JSON_BODY_BYTES = 1_100_000;

export async function readBoundedAgentTaskJson(
  request: Request,
  maximumBytes = MAX_AGENT_TASK_JSON_BODY_BYTES
): Promise<unknown> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new AgentTaskError("Agent task request is too large", 413);
  }
  if (!request.body) {
    throw new AgentTaskError("Agent task request body is required", 422);
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    let readResult = await reader.read();
    while (!readResult.done) {
      const { value } = readResult;
      byteLength += value.byteLength;
      if (byteLength > maximumBytes) {
        // biome-ignore lint/performance/noAwaitInLoops: Cancellation releases the oversized request stream before returning the bounded error.
        await reader.cancel("Agent task request exceeded its byte limit");
        throw new AgentTaskError("Agent task request is too large", 413);
      }
      chunks.push(value);
      readResult = await reader.read();
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch (error) {
    const invalidJson = new AgentTaskError(
      "Agent task request body must be valid JSON",
      422
    );
    invalidJson.cause = error;
    throw invalidJson;
  }
}
