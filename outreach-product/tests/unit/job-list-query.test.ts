import { describe, expect, test } from "bun:test";
import {
  jobListFilters,
  PRIVATE_JOB_EXCLUDED_BOARD,
  PRIVATE_JOB_PAGE_SIZE,
  parsePrivateJobListQuery,
  privateJobListQuery,
  privateJobListSearchParams,
} from "../../src/features/jobs/list-query";

describe("jobListFilters", () => {
  test("fills the private workspace defaults", () => {
    expect(jobListFilters()).toEqual({
      country: "all",
      fit: "all",
      publicJob: "",
      showExcluded: false,
      sort: "stated-hourly",
    });
  });

  test("keeps provided values and defaults the rest", () => {
    expect(jobListFilters({ country: "Korea", showExcluded: true })).toEqual({
      country: "Korea",
      fit: "all",
      publicJob: "",
      showExcluded: true,
      sort: "stated-hourly",
    });
  });
});

describe("privateJobListQuery", () => {
  test("always excludes the anesl board at full page size", () => {
    const query = privateJobListQuery(jobListFilters(), {
      cursor: "",
      offset: 0,
    });
    expect(query.excludeBoard).toBe(PRIVATE_JOB_EXCLUDED_BOARD);
    expect(query.excludeBoard).toBe("anesl");
    expect(query.limit).toBe(PRIVATE_JOB_PAGE_SIZE);
  });

  test("threads the page cursor and offset through", () => {
    const query = privateJobListQuery(jobListFilters({ fit: "strong" }), {
      cursor: "abc",
      offset: 200,
    });
    expect(query.cursor).toBe("abc");
    expect(query.offset).toBe(200);
    expect(query.fit).toBe("strong");
  });
});

describe("search-param round trip", () => {
  test("default filters survive serialize and parse", () => {
    const query = privateJobListQuery(jobListFilters(), {
      cursor: "",
      offset: 0,
    });
    const parsed = parsePrivateJobListQuery(privateJobListSearchParams(query));
    expect(parsed).toEqual(query);
  });

  test("custom filters survive serialize and parse", () => {
    const query = privateJobListQuery(
      jobListFilters({
        country: "Korea",
        fit: "strong",
        publicJob: "pub-1",
        showExcluded: true,
        sort: "monthly-pay",
      }),
      { cursor: "Y3Vyc29y", offset: 100 }
    );
    const parsed = parsePrivateJobListQuery(privateJobListSearchParams(query));
    expect(parsed).toEqual(query);
  });
});
