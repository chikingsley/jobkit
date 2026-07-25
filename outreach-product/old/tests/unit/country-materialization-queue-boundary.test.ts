import { describe, expect, test } from "bun:test";
import { readBoundedAgentTaskJson } from "../../worker/services/agent-tasks/bounded-json";
import { CountryMaterializationQueueMessageSchema } from "../../worker/services/country-materialization/queue";

describe("country materialization execution boundary", () => {
  test("accepts only the compact versioned wake-up schema", () => {
    const message = {
      aggregateId: "output-1",
      kind: "country_sweep_materialization",
      version: 1,
      workItemId: "outbox-1",
    } as const;
    expect(CountryMaterializationQueueMessageSchema.parse(message)).toEqual(
      message
    );
    expect(
      CountryMaterializationQueueMessageSchema.safeParse({
        ...message,
        records: [{ id: "domain-row" }],
      }).success
    ).toBe(false);
  });

  test("counts fragmented request bytes before parsing JSON", async () => {
    const valid = streamedRequest(['{"records":', "[]}"]);
    await expect(readBoundedAgentTaskJson(valid, 32)).resolves.toEqual({
      records: [],
    });

    const oversized = streamedRequest(["1234", "5678", "9"]);
    await expect(readBoundedAgentTaskJson(oversized, 8)).rejects.toMatchObject({
      message: "Agent task request is too large",
      status: 413,
    });
  });
});

function streamedRequest(chunks: string[]) {
  const encoder = new TextEncoder();
  return {
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    }),
    headers: new Headers(),
  } as Request;
}
