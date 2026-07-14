import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("outreach Worker", () => {
  it("serves health through the production Worker entrypoint", async () => {
    const response = await exports.default.fetch(
      "https://outreach.test/api/health"
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("publishes the OpenAPI contract through the production entrypoint", async () => {
    const response = await exports.default.fetch(
      "https://outreach.test/openapi.json"
    );
    const document = (await response.json()) as {
      info: { title: string };
      openapi: string;
    };

    expect(response.status).toBe(200);
    expect(document.info.title).toBe("JobKit Outreach API");
    expect(document.openapi).toBe("3.1.0");
  });

  it("rejects malformed profile data as a client error", async () => {
    const response = await exports.default.fetch(
      "https://outreach.test/api/profile",
      {
        body: JSON.stringify({ fullName: 42 }),
        headers: { "content-type": "application/json" },
        method: "PUT",
      }
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      message: "Request did not match the expected schema",
      ok: false,
    });
  });
});
