import {
  useNavigate,
  useRouter,
  useRouterState,
  useSearch,
} from "@tanstack/react-router";
import { useCallback } from "react";
import type { JobSort } from "@/features/jobs/sorting";
import {
  detailCloseNavigationIntent,
  jobOpenNavigationIntent,
  messageOpenNavigationIntent,
  publicJobResolutionNavigationIntent,
} from "@/features/workspace/query-navigation";

const DEFAULT_JOB_SORT: JobSort = "stated-hourly";

export function useJobsQueryState() {
  const navigate = useNavigate({ from: "/app/jobs" });
  const router = useRouter();
  const search = useSearch({ from: "/app/jobs" });
  const historyState = useRouterState({
    select: (state) => state.location.state,
  });
  const setCountryFilter = useCallback(
    (country: string) =>
      navigate({
        replace: true,
        search: (current) => ({
          ...current,
          country: country === "all" ? undefined : country,
          detail: undefined,
          job: undefined,
          publicJob: undefined,
        }),
      }),
    [navigate]
  );
  const setFitFilter = useCallback(
    (fit: string) =>
      navigate({
        replace: true,
        search: (current) => ({
          ...current,
          detail: undefined,
          fit: fit === "all" ? undefined : fit,
          job: undefined,
          publicJob: undefined,
        }),
      }),
    [navigate]
  );
  const setSelectedJobId = useCallback(
    (job: string) =>
      navigate({
        replace: true,
        search: (current) => ({
          ...current,
          job: job || undefined,
          publicJob: undefined,
        }),
      }),
    [navigate]
  );
  const resolvePublicJobIntent = useCallback(
    (job: string) =>
      navigate({
        replace: true,
        search: (current) => publicJobResolutionNavigationIntent(current, job),
      }),
    [navigate]
  );
  const openJob = useCallback(
    (job: string) => {
      const intent = jobOpenNavigationIntent(search, job, historyState);
      return navigate({
        replace: intent.replace,
        search: { ...intent.search, publicJob: undefined },
        state: (current) => ({ ...current, ...intent.state }),
      });
    },
    [historyState, navigate, search]
  );
  const closeDetail = useCallback(() => {
    if (search.publicJob) {
      void navigate({
        replace: true,
        search: (current) => ({
          ...current,
          detail: undefined,
          publicJob: undefined,
        }),
      });
      return;
    }
    const intent = detailCloseNavigationIntent("jobs", historyState);
    if (intent.history === "go") {
      router.history.go(intent.delta);
      return;
    }
    void navigate({
      replace: true,
      search: (current) => ({ ...current, detail: undefined }),
      state: (current) => ({
        ...current,
        jobkitDetailReturnIndex: undefined,
        jobkitDetailSurface: undefined,
      }),
    });
  }, [historyState, navigate, router.history, search.publicJob]);
  const setShowExcluded = useCallback(
    (excluded: boolean) =>
      navigate({
        replace: true,
        search: (current) => ({
          ...current,
          detail: undefined,
          excluded: excluded ? true : undefined,
          job: undefined,
          publicJob: undefined,
        }),
      }),
    [navigate]
  );
  const setSort = useCallback(
    (sort: JobSort) =>
      navigate({
        replace: true,
        search: (current) => ({
          ...current,
          sort: sort === DEFAULT_JOB_SORT ? undefined : sort,
        }),
      }),
    [navigate]
  );

  return {
    closeDetail,
    countryFilter: search.country ?? "all",
    detailOpen: search.detail ?? false,
    fitFilter: search.fit ?? "all",
    openJob,
    publicJobIntent: search.publicJob ?? "",
    resolvePublicJobIntent,
    selectedJobId: search.job ?? "",
    setCountryFilter,
    setFitFilter,
    setSelectedJobId,
    setShowExcluded,
    setSort,
    showExcluded: search.excluded ?? false,
    sort: search.sort ?? DEFAULT_JOB_SORT,
  };
}

export function useMessagesQueryState() {
  const navigate = useNavigate({ from: "/app/messages" });
  const router = useRouter();
  const search = useSearch({ from: "/app/messages" });
  const historyState = useRouterState({
    select: (state) => state.location.state,
  });
  const setSelectedThreadId = useCallback(
    (thread: string) =>
      navigate({
        replace: true,
        search: (current) => ({ ...current, thread: thread || undefined }),
      }),
    [navigate]
  );
  const openThread = useCallback(
    (thread: string) => {
      const intent = messageOpenNavigationIntent(search, thread, historyState);
      return navigate({
        replace: intent.replace,
        search: intent.search,
        state: (current) => ({ ...current, ...intent.state }),
      });
    },
    [historyState, navigate, search]
  );
  const closeDetail = useCallback(() => {
    const intent = detailCloseNavigationIntent("messages", historyState);
    if (intent.history === "go") {
      router.history.go(intent.delta);
      return;
    }
    void navigate({
      replace: true,
      search: (current) => ({ ...current, detail: undefined }),
      state: (current) => ({
        ...current,
        jobkitDetailReturnIndex: undefined,
        jobkitDetailSurface: undefined,
      }),
    });
  }, [historyState, navigate, router.history]);

  return {
    closeDetail,
    detailOpen: search.detail ?? false,
    openThread,
    selectedThreadId: search.thread ?? "",
    setSelectedThreadId,
  };
}
