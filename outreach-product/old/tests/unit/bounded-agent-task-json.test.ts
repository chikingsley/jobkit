import { describe, expect, test } from "bun:test";
import { readBoundedAgentTaskJson } from "../../worker/services/agent-tasks/bounded-json";

describe("bounded agent task JSON", () => {
  test("counts streamed bytes even when Content-Length understates the body", async () => {
    const bytes = new TextEncoder().encode(
      JSON.stringify({ value: "x".repeat(80) })
    );
    const request = new Request("https://outreach.test/agent-task", {
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes.slice(0, 40));
          controller.enqueue(bytes.slice(40));
          controller.close();
        },
      }),
      headers: {
        "content-length": "1",
        "content-type": "application/json",
      },
      method: "POST",
    });

    await expect(readBoundedAgentTaskJson(request, 64)).rejects.toMatchObject({
      status: 413,
    });
  });

  test("parses a body at or below the measured byte limit", async () => {
    const body = JSON.stringify({ ok: true });
    const request = new Request("https://outreach.test/agent-task", {
      body,
      headers: { "content-type": "application/json" },
      method: "POST",
    });

    await expect(
      readBoundedAgentTaskJson(
        request,
        new TextEncoder().encode(body).byteLength
      )
    ).resolves.toEqual({ ok: true });
  });
});
