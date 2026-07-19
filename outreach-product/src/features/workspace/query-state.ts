import { useCallback } from "react";
import { useSearchParams } from "react-router";
import type { JobSort } from "@/features/jobs/sorting";

const DEFAULT_COUNTRY_FILTER = "all";
const DEFAULT_FIT_FILTER = "all";
const DEFAULT_JOB_SORT: JobSort = "stated-hourly";
const JOB_SORTS = new Set<JobSort>([
  "monthly-pay",
  "review-order",
  "stated-hourly",
]);

export function useWorkspaceQueryState() {
  const [searchParams, setSearchParams] = useSearchParams();
  const update = useCallback(
    (
      key: string,
      value: string,
      defaultValue = "",
      resetKeys: string[] = []
    ) => {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          if (!value || value === defaultValue) {
            next.delete(key);
          } else {
            next.set(key, value);
          }
          for (const resetKey of resetKeys) {
            next.delete(resetKey);
          }
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );
  const requestedSort = searchParams.get("sort") as JobSort | null;
  const setCountryFilter = useCallback(
    (value: string) =>
      update("country", value, DEFAULT_COUNTRY_FILTER, ["detail", "job"]),
    [update]
  );
  const setFitFilter = useCallback(
    (value: string) =>
      update("fit", value, DEFAULT_FIT_FILTER, ["detail", "job"]),
    [update]
  );
  const setDetailOpen = useCallback(
    (value: boolean) => update("detail", value ? "1" : ""),
    [update]
  );
  const setSelectedJobId = useCallback(
    (value: string) => update("job", value),
    [update]
  );
  const setSelectedThreadId = useCallback(
    (value: string) => update("thread", value),
    [update]
  );
  const setShowExcluded = useCallback(
    (value: boolean) =>
      update("excluded", value ? "1" : "", "", ["detail", "job"]),
    [update]
  );
  const setSort = useCallback(
    (value: JobSort) => update("sort", value, DEFAULT_JOB_SORT),
    [update]
  );

  return {
    countryFilter: searchParams.get("country") || DEFAULT_COUNTRY_FILTER,
    detailOpen: searchParams.get("detail") === "1",
    fitFilter: searchParams.get("fit") || DEFAULT_FIT_FILTER,
    selectedJobId: searchParams.get("job") ?? "",
    selectedThreadId: searchParams.get("thread") ?? "",
    setCountryFilter,
    setDetailOpen,
    setFitFilter,
    setSelectedJobId,
    setSelectedThreadId,
    setShowExcluded,
    setSort,
    showExcluded: searchParams.get("excluded") === "1",
    sort:
      requestedSort && JOB_SORTS.has(requestedSort)
        ? requestedSort
        : DEFAULT_JOB_SORT,
  };
}
