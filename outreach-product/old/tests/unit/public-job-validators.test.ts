import { describe, expect, it } from "bun:test";
import {
  publicJobDetailEtag,
  publicJobListEtag,
  publicRepresentationIsFresh,
  publicValidatorHeaders,
} from "../../worker/public-jobs/validators";

const strongEtagPattern = /^"[0-9a-f]{64}"$/u;

describe("public representation validators", () => {
  it("builds stable strong list and detail validators from exact contracts", async () => {
    const detail = await publicJobDetailEtag({
      canonicalPath: "/job/pjob_v1_abc/example",
      eligibilityDecisionHash: "eligibility-hash",
      publicContentHash: "content-hash",
    });
    const list = await publicJobListEtag({
      cursor: null,
      membershipHash: "membership-hash",
      queryHash: "query-hash",
      scope: { kind: "global" },
      searchIndexVersion: "search-v1",
    });

    expect(detail).toMatch(strongEtagPattern);
    expect(list).toMatch(strongEtagPattern);
    expect(
      await publicJobListEtag({
        cursor: null,
        membershipHash: "membership-hash",
        queryHash: "query-hash",
        scope: { kind: "global" },
        searchIndexVersion: "search-v1",
      })
    ).toBe(list);
    expect(
      await publicJobListEtag({
        cursor: "next-page",
        membershipHash: "membership-hash",
        queryHash: "query-hash",
        scope: { kind: "global" },
        searchIndexVersion: "search-v1",
      })
    ).not.toBe(list);
  });

  it("gives If-None-Match precedence and accepts weak comparison for GET", () => {
    const validators = {
      etag: '"abc"',
      lastModified: "2026-07-22T12:34:56.789Z",
    };

    expect(
      publicRepresentationIsFresh(
        new Headers({ "If-None-Match": '"other", W/"abc"' }),
        validators
      )
    ).toBeTrue();
    expect(
      publicRepresentationIsFresh(
        new Headers({
          "If-Modified-Since": "Wed, 22 Jul 2026 12:34:57 GMT",
          "If-None-Match": '"other"',
        }),
        validators
      )
    ).toBeFalse();
  });

  it("normalizes Last-Modified to HTTP-date seconds", () => {
    const headers = publicValidatorHeaders({
      etag: '"abc"',
      lastModified: "2026-07-22T12:34:56.789Z",
    });

    expect(headers.get("cache-control")).toBe(
      "public, max-age=0, must-revalidate"
    );
    expect(headers.get("etag")).toBe('"abc"');
    expect(headers.get("last-modified")).toBe("Wed, 22 Jul 2026 12:34:56 GMT");
    expect(
      publicRepresentationIsFresh(
        new Headers({
          "If-Modified-Since": "Wed, 22 Jul 2026 12:34:56 GMT",
        }),
        {
          etag: '"abc"',
          lastModified: "2026-07-22T12:34:56.789Z",
        }
      )
    ).toBeTrue();
  });
});
