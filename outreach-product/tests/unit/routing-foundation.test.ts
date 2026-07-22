import { describe, expect, it } from "bun:test";
import { legacyWorkspaceDestination } from "../../src/features/workspace/legacy-routes";
import {
  detailCloseNavigationIntent,
  jobOpenNavigationIntent,
  messageOpenNavigationIntent,
  publicJobResolutionNavigationIntent,
} from "../../src/features/workspace/query-navigation";
import {
  jobsSearchSchema,
  messagesSearchSchema,
  newCampaignSearchSchema,
  testLabSearchSchema,
} from "../../src/features/workspace/search";
import {
  applyDocumentCachePolicy,
  createRoutedWorker,
  isHonoRequest,
} from "../../src/server-routing";

describe("legacy workspace redirects", () => {
  it("maps exact legacy screens into the private app namespace", () => {
    expect(legacyWorkspaceDestination("/campaigns")).toBe("/app/campaigns");
    expect(legacyWorkspaceDestination("/message-style")).toBe(
      "/app/settings/writing-style"
    );
    expect(legacyWorkspaceDestination("/profile")).toBe(
      "/app/settings/profile"
    );
  });

  it("preserves encoded dynamic identifiers", () => {
    expect(legacyWorkspaceDestination("/campaigns/one%20two")).toBe(
      "/app/campaigns/one%20two"
    );
    expect(legacyWorkspaceDestination("/campaigns/markets/GB")).toBe(
      "/app/campaigns/markets/GB"
    );
  });

  it("leaves public and malformed paths available to the Start 404", () => {
    expect(legacyWorkspaceDestination("/jobs/poland")).toBeNull();
    expect(legacyWorkspaceDestination("/campaigns/bad%ZZ")).toBeNull();
  });
});

describe("validated route search", () => {
  it("normalizes job state to stable defaults", () => {
    const parsed = jobsSearchSchema.parse({
      country: 42,
      detail: "true",
      excluded: "0",
      fit: null,
      sort: "invented",
    });

    expect(parsed.detail).toBeTrue();
    expect(parsed.excluded).toBeFalse();
    expect(parsed.country).toBeUndefined();
    expect(parsed.fit).toBeUndefined();
    expect(parsed.sort).toBeUndefined();
  });

  it("normalizes message, campaign, and test-lab state", () => {
    expect(
      messagesSearchSchema.parse({ detail: 1, thread: "thread-1" })
    ).toEqual({ detail: true, thread: "thread-1" });
    expect(newCampaignSearchSchema.parse({ country: " pl " })).toEqual({
      country: "PL",
    });
    expect(testLabSearchSchema.parse({ tab: "unknown" }).tab).toBeUndefined();
  });

  it("accepts malformed and overlong job search values", () => {
    const parsed = jobsSearchSchema.parse({
      country: { value: "PL" },
      detail: "banana",
      excluded: [true],
      fit: 42,
      job: "j".repeat(201),
      sort: "invented",
    });

    expect(parsed).toEqual({
      country: undefined,
      detail: undefined,
      excluded: undefined,
      fit: undefined,
      job: undefined,
      sort: undefined,
    });
    expect(jobsSearchSchema.parse(null)).toEqual({});
  });

  it("accepts malformed and overlong message search values", () => {
    expect(
      messagesSearchSchema.parse({
        detail: { open: true },
        thread: "t".repeat(201),
      })
    ).toEqual({ detail: undefined, thread: undefined });
    expect(messagesSearchSchema.parse("wrong-object-type")).toEqual({});
  });

  it("accepts malformed and overlong campaign search values", () => {
    expect(newCampaignSearchSchema.parse({ country: "POLAND" })).toEqual({
      country: undefined,
    });
    expect(newCampaignSearchSchema.parse({ country: ["PL"] })).toEqual({
      country: undefined,
    });
    expect(newCampaignSearchSchema.parse(false)).toEqual({});
  });

  it("accepts malformed and overlong test-lab search values", () => {
    expect(
      testLabSearchSchema.parse({
        case: "c".repeat(201),
        classification: { id: "classification-1" },
        tab: 3,
      })
    ).toEqual({
      case: undefined,
      classification: undefined,
      tab: undefined,
    });
    expect(testLabSearchSchema.parse([])).toEqual({});
  });
});

describe("atomic item navigation", () => {
  it("pushes a job ID and open detail state in one search object", () => {
    const intent = jobOpenNavigationIntent(
      { country: "PL", sort: "monthly-pay" },
      "job-42",
      { __TSR_index: 7 }
    );

    expect(intent).toEqual({
      replace: false,
      search: {
        country: "PL",
        detail: true,
        job: "job-42",
        sort: "monthly-pay",
      },
      state: {
        jobkitDetailReturnIndex: 7,
        jobkitDetailSurface: "jobs",
      },
    });
  });

  it("resolves a public Apply intent into the mapped private job", () => {
    expect(
      publicJobResolutionNavigationIntent(
        {
          country: "PL",
          publicJob: "pjob_v1_public",
          sort: "monthly-pay",
        },
        "private-job-42"
      )
    ).toEqual({
      country: "PL",
      detail: true,
      job: "private-job-42",
      publicJob: undefined,
      sort: "monthly-pay",
    });
  });

  it("pushes a thread ID and open detail state in one search object", () => {
    const intent = messageOpenNavigationIntent(
      { thread: "old-thread" },
      "new-thread",
      { __TSR_index: 3 }
    );

    expect(intent).toEqual({
      replace: false,
      search: { detail: true, thread: "new-thread" },
      state: {
        jobkitDetailReturnIndex: 3,
        jobkitDetailSurface: "messages",
      },
    });
  });

  it("returns through the item-open sequence and preserves Forward history", () => {
    const secondOpen = jobOpenNavigationIntent(
      { detail: true, job: "job-1" },
      "job-2",
      {
        __TSR_index: 9,
        jobkitDetailReturnIndex: 7,
        jobkitDetailSurface: "jobs",
      }
    );

    expect(secondOpen.state.jobkitDetailReturnIndex).toBe(7);
    expect(
      detailCloseNavigationIntent("jobs", {
        __TSR_index: 10,
        ...secondOpen.state,
      })
    ).toEqual({ delta: -3, history: "go" });
  });

  it("replaces detail state when a direct link has no list history", () => {
    expect(detailCloseNavigationIntent("messages", { __TSR_index: 4 })).toEqual(
      { history: "replace" }
    );
  });
});

describe("production request dispatch", () => {
  it("reserves the API and OpenAPI namespaces for Hono", () => {
    expect(isHonoRequest("/api")).toBeTrue();
    expect(isHonoRequest("/api/missing")).toBeTrue();
    expect(isHonoRequest("/openapi.json")).toBeTrue();
    expect(isHonoRequest("/apiary")).toBeFalse();
    expect(isHonoRequest("/app/jobs")).toBeFalse();
  });

  it("preserves Hono responses and applies document cache policy to Start", async () => {
    const env = { binding: "start-context" };
    const ctx = {} as ExecutionContext;
    let receivedStartContext:
      | {
          ctx: ExecutionContext;
          env: typeof env;
        }
      | undefined;
    const honoResponse = new Response('{"ok":false}', {
      headers: {
        "content-type": "application/json",
        "set-cookie": "session=kept; HttpOnly",
        "x-webhook-proof": "kept",
      },
      status: 404,
    });
    const worker = createRoutedWorker<typeof env>({
      fetchHono: () => honoResponse,
      fetchStart: (_request, startEnv, startCtx) => {
        receivedStartContext = { ctx: startCtx, env: startEnv };
        return new Response("<main>JobKit</main>", {
          headers: {
            "content-type": "text/html; charset=utf-8",
            "set-cookie": "session=must-not-leak; HttpOnly",
            vary: "Accept-Encoding, Cookie",
          },
        });
      },
      runQueue: () => undefined,
      runScheduled: () => undefined,
    });

    const api = await worker.fetch(
      new Request("https://jobkit.test/api/missing"),
      env,
      ctx
    );
    const document = await worker.fetch(
      new Request("https://jobkit.test/jobs"),
      env,
      ctx
    );

    expect(api).toBe(honoResponse);
    expect(api.headers.get("set-cookie")).toContain("session=kept");
    expect(api.headers.get("x-webhook-proof")).toBe("kept");
    expect(await api.text()).toBe('{"ok":false}');
    expect(document.headers.get("cache-control")).toBe(
      "public, max-age=0, must-revalidate"
    );
    expect(document.headers.get("set-cookie")).toBeNull();
    expect(document.headers.get("vary")).toBe("Accept-Encoding");
    expect(receivedStartContext).toEqual({ ctx, env });
  });

  it("marks private documents and server-function responses private", () => {
    const privateDocument = applyDocumentCachePolicy(
      "/app/jobs",
      new Response("<main>Private</main>", {
        headers: { "content-type": "text/html" },
      })
    );
    const serverFunction = applyDocumentCachePolicy(
      "/_server",
      new Response("{}", {
        headers: { "content-type": "application/json" },
      })
    );

    expect(privateDocument.headers.get("cache-control")).toBe(
      "private, no-store"
    );
    expect(serverFunction.headers.get("cache-control")).toBe(
      "private, no-store"
    );
  });

  it("delegates each scheduled and queue event exactly once", () => {
    let queueCalls = 0;
    let scheduledCalls = 0;
    const worker = createRoutedWorker<undefined>({
      fetchHono: () => new Response(),
      fetchStart: () => new Response(),
      runQueue: () => {
        queueCalls += 1;
      },
      runScheduled: () => {
        scheduledCalls += 1;
      },
    });
    const ctx = {} as ExecutionContext;

    worker.scheduled({} as ScheduledController, undefined, ctx);
    worker.queue({} as MessageBatch, undefined, ctx);

    expect(queueCalls).toBe(1);
    expect(scheduledCalls).toBe(1);
  });
});
