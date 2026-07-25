import type { JobsSearch, MessagesSearch } from "@/features/workspace/search";

export type DetailSurface = "jobs" | "messages";

export interface DetailNavigationState {
  __TSR_index: number;
  jobkitDetailReturnIndex?: number;
  jobkitDetailSurface?: DetailSurface;
}

declare module "@tanstack/history" {
  interface HistoryState {
    jobkitDetailReturnIndex?: number;
    jobkitDetailSurface?: DetailSurface;
  }
}

interface ItemOpenIntent<Search> {
  replace: false;
  search: Search;
  state: Pick<
    DetailNavigationState,
    "jobkitDetailReturnIndex" | "jobkitDetailSurface"
  >;
}

function itemOpenIntent<Search extends { detail?: boolean }>(
  current: Search,
  selected: Record<string, string>,
  surface: DetailSurface,
  state: DetailNavigationState
): ItemOpenIntent<Search> {
  const existingReturnIndex =
    state.jobkitDetailSurface === surface &&
    typeof state.jobkitDetailReturnIndex === "number"
      ? state.jobkitDetailReturnIndex
      : state.__TSR_index;

  return {
    replace: false,
    search: { ...current, ...selected, detail: true },
    state: {
      jobkitDetailReturnIndex: existingReturnIndex,
      jobkitDetailSurface: surface,
    },
  };
}

export function jobOpenNavigationIntent(
  current: JobsSearch,
  job: string,
  state: DetailNavigationState
): ItemOpenIntent<JobsSearch> {
  return itemOpenIntent(current, { job }, "jobs", state);
}

export function publicJobResolutionNavigationIntent(
  current: JobsSearch,
  job: string
): JobsSearch {
  return {
    ...current,
    detail: true,
    job,
    publicJob: undefined,
  };
}

export function messageOpenNavigationIntent(
  current: MessagesSearch,
  thread: string,
  state: DetailNavigationState
): ItemOpenIntent<MessagesSearch> {
  return itemOpenIntent(current, { thread }, "messages", state);
}

export type DetailCloseIntent =
  | { delta: number; history: "go" }
  | { history: "replace" };

export function detailCloseNavigationIntent(
  surface: DetailSurface,
  state: DetailNavigationState
): DetailCloseIntent {
  const returnIndex = state.jobkitDetailReturnIndex;
  if (
    state.jobkitDetailSurface === surface &&
    typeof returnIndex === "number" &&
    returnIndex < state.__TSR_index
  ) {
    return { delta: returnIndex - state.__TSR_index, history: "go" };
  }
  return { history: "replace" };
}
