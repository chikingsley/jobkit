import { describe, expect, it } from "vitest";
import type { JobMatch } from "@/profile-types";
import { filterJobs, selectVisibleJob } from "./filters";
import type { Job } from "./types";

const jobs = [
  { country: "Japan", id: "jp" },
  { country: "Poland", id: "pl" },
] as Job[];

const matches = new Map<string, JobMatch>([
  ["jp", { label: "Strong match" } as JobMatch],
  ["pl", { label: "Ineligible" } as JobMatch],
]);

describe("job queue filtering", () => {
  it("hides ineligible jobs unless the user explicitly includes them", () => {
    expect(
      filterJobs(jobs, matches, {
        country: "all",
        fit: "all",
        showExcluded: false,
      }).map((job) => job.id)
    ).toEqual(["jp"]);
  });

  it("selects a visible fallback when filters remove the prior selection", () => {
    const visible = filterJobs(jobs, matches, {
      country: "Japan",
      fit: "all",
      showExcluded: true,
    });

    expect(selectVisibleJob(visible, "pl")?.id).toBe("jp");
  });
});
