import { describe, expect, it } from "bun:test";
import {
  publicJobsSearchParameters,
  publicJobsSearchSchema,
} from "../../src/features/public/job-search";

describe("public job route search", () => {
  it("keeps the first singleton value and drops unknown or invalid values", () => {
    expect(
      publicJobsSearchSchema.parse({
        compensation: ["negotiable", "stated"],
        country: [" pl ", "GB"],
        employmentType: "invented",
        extra: "private-state",
        q: ["  English  teacher ", "ignored"],
        sort: ["title", "recent"],
        workplace: { value: "remote" },
      })
    ).toEqual({
      compensation: "negotiable",
      country: " pl ",
      employmentType: undefined,
      q: "  English  teacher ",
      sort: "title",
      workplace: undefined,
    });
  });

  it("preserves overlong values for the server contract to return 400", () => {
    const q = "q".repeat(121);
    const cursor = "c".repeat(1025);
    const search = publicJobsSearchSchema.parse({ cursor, q });

    expect(search).toEqual({ cursor, q });
    expect(publicJobsSearchParameters(search).toString()).toBe(
      `q=${q}&cursor=${cursor}`
    );
  });

  it("serializes only the public loader dependency keys", () => {
    const search = publicJobsSearchSchema.parse({
      compensation: "stated",
      country: "PL",
      cursor: "cursor-value",
      employmentType: "fullTime",
      limit: 30,
      q: "English",
      sort: "relevance",
      workplace: "onsite",
    });

    expect(Object.fromEntries(publicJobsSearchParameters(search))).toEqual({
      compensation: "stated",
      country: "PL",
      cursor: "cursor-value",
      employmentType: "fullTime",
      limit: "30",
      q: "English",
      sort: "relevance",
      workplace: "onsite",
    });
  });
});
