import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { inventoryClient } from "../../cli/job-inventory/publish";

const fetchSpies: ReturnType<typeof spyOn>[] = [];

afterEach(() => {
  for (const fetchSpy of fetchSpies.splice(0)) {
    fetchSpy.mockRestore();
  }
});

describe("inventory publisher transport", () => {
  test("retries a transient server response", async () => {
    const fetchSpy = spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        Response.json(
          { message: "Inventory storage is temporarily unavailable" },
          { status: 503 }
        )
      )
      .mockResolvedValueOnce(Response.json({ ok: true }));
    fetchSpies.push(fetchSpy);

    await expect(
      inventoryClient("https://outreach.test", "runner-token").post(
        "/api/inventory/runs/run-1/batches",
        { batchKey: "batch-1" }
      )
    ).resolves.toEqual({ ok: true });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  test("surfaces a source-data response immediately", async () => {
    const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValueOnce(
      Response.json(
        { message: "Inventory batch contains invalid source data" },
        { status: 422 }
      )
    );
    fetchSpies.push(fetchSpy);

    await expect(
      inventoryClient("https://outreach.test", "runner-token").post(
        "/api/inventory/runs/run-1/batches",
        { batchKey: "batch-1" }
      )
    ).rejects.toThrow("Inventory request failed (422)");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
