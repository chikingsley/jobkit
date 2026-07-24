import { describe, expect, test } from "bun:test";
import {
  emptyJobListPageMeta,
  firstJobListPageParam,
  flattenJobPages,
  hasActiveDraftTask,
  type JobListPageData,
  type JobListPageMeta,
  latestJobListMeta,
  mergeJobMatches,
  nextJobListPageParam,
} from "../../src/features/jobs/list-pages";
import type { JobListItem } from "../../src/features/jobs/types";
import type { JobMatchSummary } from "../../src/profile-types";

function job(id: string, overrides: Partial<JobListItem> = {}): JobListItem {
  return {
    analysisStatus: {
      content: "current",
      matchFacts: "current",
      positions: "current",
    },
    applicationRoutes: [],
    board: "eslcafe",
    company: `Company ${id}`,
    compensation: {
      amountMax: 30,
      amountMin: 20,
      confidence: "exact",
      currency: "USD",
      display: "$20-30/hour",
      notes: [],
      period: "hour",
      qualifier: "range",
      source: "listing-field",
    },
    country: "Korea",
    draftTask: null,
    emailAttempt: null,
    housing: null,
    id,
    location: "Seoul",
    marketSegments: [],
    messageRoute: "advertised_position",
    opportunityScope: "direct",
    positionCount: 1,
    publicJobId: null,
    statedHourly: {
      basis: "listed",
      currency: "USD",
      maximum: 30,
      minimum: 20,
      taxBasis: "unspecified",
    },
    status: "new",
    title: `Job ${id}`,
    ...overrides,
  };
}

function match(score: number): JobMatchSummary {
  return {
    confirmedRequirements: 2,
    conflicts: 0,
    label: "Likely match",
    score,
    tone: "positive",
    totalRequirements: 3,
    unknowns: 1,
  };
}

function page(
  jobs: JobListItem[],
  overrides: Partial<JobListPageData> = {},
  meta: Partial<JobListPageMeta> = {}
): JobListPageData {
  return {
    countries: ["Korea"],
    fx: { rates: { USD: 1 }, updatedAt: "2026-07-23T00:00:00Z" },
    jobs,
    matches: {},
    nextCursor: null,
    page: {
      appliedCount: 4,
      hasMore: false,
      limit: 100,
      offset: 0,
      totalAvailable: 250,
      totalCount: 180,
      ...meta,
    },
    ...overrides,
  };
}

describe("flattenJobPages", () => {
  test("concatenates pages preserving order", () => {
    const pages = [page([job("a"), job("b")]), page([job("c")])];
    expect(flattenJobPages(pages).map((item) => item.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  test("dedupes by id keeping the latest occurrence", () => {
    const pages = [
      page([job("a", { status: "new" }), job("b")]),
      page([job("a", { status: "review" }), job("c")]),
    ];
    const flattened = flattenJobPages(pages);
    expect(flattened).toHaveLength(3);
    expect(flattened.find((item) => item.id === "a")?.status).toBe("review");
  });
});

describe("mergeJobMatches", () => {
  test("later pages win on conflicting ids", () => {
    const pages = [
      page([], { matches: { a: match(90), b: match(70) } }),
      page([], { matches: { a: match(40) } }),
    ];
    const merged = mergeJobMatches(pages);
    expect(merged.size).toBe(2);
    expect(merged.get("a")).toEqual(match(40));
    expect(merged.get("b")).toEqual(match(70));
  });
});

describe("nextJobListPageParam", () => {
  test("returns undefined when the page has no more rows", () => {
    const last = page([job("a")], { nextCursor: "cursor-1" });
    expect(nextJobListPageParam(last, [last])).toBeUndefined();
  });

  test("returns undefined when the server omitted a cursor", () => {
    const last = page([job("a")], {}, { hasMore: true });
    expect(nextJobListPageParam(last, [last])).toBeUndefined();
  });

  test("uses the server cursor and the deduped job count as offset", () => {
    const first = page([job("a"), job("b")]);
    const last = page(
      [job("b"), job("c")],
      { nextCursor: "cursor-2" },
      {
        hasMore: true,
      }
    );
    expect(nextJobListPageParam(last, [first, last])).toEqual({
      cursor: "cursor-2",
      offset: 3,
    });
  });
});

describe("latestJobListMeta", () => {
  test("returns empty defaults without pages", () => {
    const meta = latestJobListMeta([]);
    expect(meta.page).toEqual(emptyJobListPageMeta);
    expect(meta.countries).toEqual([]);
    expect(meta.fx).toEqual({ rates: {}, updatedAt: null });
  });

  test("returns the most recent page's counts and countries", () => {
    const pages = [
      page([], { countries: ["Korea"] }, { totalCount: 180 }),
      page([], { countries: ["Korea", "Japan"] }, { totalCount: 179 }),
    ];
    const meta = latestJobListMeta(pages);
    expect(meta.page.totalCount).toBe(179);
    expect(meta.countries).toEqual(["Korea", "Japan"]);
  });
});

describe("hasActiveDraftTask", () => {
  const draftTask = (status: "claimed" | "completed" | "queued") => ({
    error: "",
    id: "task-1",
    mode: "generate" as const,
    status,
    updatedAt: "2026-07-23T00:00:00Z",
  });

  test("false when no job has a pending draft task", () => {
    const pages = [
      page([job("a"), job("b", { draftTask: draftTask("completed") })]),
    ];
    expect(hasActiveDraftTask(pages)).toBe(false);
  });

  test("true while a draft task is queued or claimed on any page", () => {
    expect(
      hasActiveDraftTask([
        page([job("a")]),
        page([job("b", { draftTask: draftTask("queued") })]),
      ])
    ).toBe(true);
    expect(
      hasActiveDraftTask([
        page([job("b", { draftTask: draftTask("claimed") })]),
      ])
    ).toBe(true);
  });
});

describe("firstJobListPageParam", () => {
  test("starts from an empty cursor at offset zero", () => {
    expect(firstJobListPageParam).toEqual({ cursor: "", offset: 0 });
  });
});
