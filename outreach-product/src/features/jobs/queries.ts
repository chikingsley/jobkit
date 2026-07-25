import {
  type InfiniteData,
  infiniteQueryOptions,
  keepPreviousData,
  type QueryClient,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import {
  firstJobListPageParam,
  hasActiveDraftTask,
  type JobListPageData,
  type JobListPageParam,
  latestJobListMeta,
  nextJobListPageParam,
} from "@/features/jobs/list-pages";
import {
  type JobListFilters,
  jobListFilters,
  privateJobListQuery,
  privateJobListSearchParams,
} from "@/features/jobs/list-query";
import type { JobSort } from "@/features/jobs/sorting";
import type { DraftMutationResult, Job } from "@/features/jobs/types";
import { apiJson, apiRequest } from "@/lib/api";
import type { JobMatch } from "@/profile-types";

const DRAFT_TASK_REFRESH_MS = 1500;

export interface JobDetailData {
  job: Job;
  match: JobMatch;
}

export const jobsKeys = {
  all: ["jobs"] as const,
  detail: (jobId: string) => ["jobs", "detail", jobId] as const,
  details: () => ["jobs", "detail"] as const,
  list: (filters: JobListFilters) => ["jobs", "list", filters] as const,
  lists: () => ["jobs", "list"] as const,
};

async function fetchJobListPage(
  filters: JobListFilters,
  pageParam: JobListPageParam
): Promise<JobListPageData> {
  const search = privateJobListSearchParams(
    privateJobListQuery(filters, pageParam)
  );
  return await apiJson<JobListPageData>(`/api/jobs?${search}`);
}

export function jobListInfiniteOptions(filters: JobListFilters) {
  return infiniteQueryOptions({
    getNextPageParam: nextJobListPageParam,
    initialPageParam: firstJobListPageParam,
    placeholderData: keepPreviousData,
    queryFn: ({ pageParam }) => fetchJobListPage(filters, pageParam),
    queryKey: jobsKeys.list(filters),
    refetchInterval: (query) =>
      hasActiveDraftTask(query.state.data?.pages ?? [])
        ? DRAFT_TASK_REFRESH_MS
        : false,
  });
}

export function useJobList(filters: JobListFilters, enabled = true) {
  return useInfiniteQuery({ ...jobListInfiniteOptions(filters), enabled });
}

const privateJobSorts: readonly JobSort[] = [
  "monthly-pay",
  "match-score",
  "review-order",
  "stated-hourly",
];

export function useJobListMeta(enabled: boolean) {
  const search = useSearch({ strict: false });
  const sort = privateJobSorts.find((candidate) => candidate === search.sort);
  const filters = jobListFilters({
    country: search.country,
    fit: search.fit,
    publicJob: search.publicJob,
    showExcluded: search.excluded,
    sort,
  });
  const listQuery = useJobList(filters, enabled);
  return latestJobListMeta(listQuery.data?.pages ?? []);
}

export function useJobDetail(jobId: string) {
  return useQuery({
    enabled: jobId !== "",
    queryFn: () => apiJson<JobDetailData>(`/api/jobs/${jobId}`),
    queryKey: jobsKeys.detail(jobId),
  });
}

interface JobActionInput {
  body?: object;
  path: string;
}

export function useJobAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ body, path }: JobActionInput) =>
      apiJson<{ message?: string; ok: boolean }>(path, {
        body: body ? JSON.stringify(body) : undefined,
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: jobsKeys.all });
    },
  });
}

interface DraftActionInput {
  body?: object;
  method?: "POST" | "PUT";
  path: string;
}

export type DraftActionOutcome =
  | { kind: "queued"; notice: string }
  | { kind: "updated"; result: DraftMutationResult };

export function useDraftAction(jobId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      body,
      method,
      path,
    }: DraftActionInput): Promise<DraftActionOutcome> => {
      const response = await apiRequest(path, {
        body: body ? JSON.stringify(body) : undefined,
        headers: { "content-type": "application/json" },
        method: method ?? "POST",
      });
      if (response.status === 202) {
        const queued = (await response.json()) as { notice: string; ok: true };
        return { kind: "queued", notice: queued.notice };
      }
      const result = (await response.json()) as DraftMutationResult;
      return { kind: "updated", result };
    },
    onSuccess: async (outcome) => {
      if (outcome.kind === "queued") {
        await queryClient.invalidateQueries({ queryKey: jobsKeys.all });
        return;
      }
      applyDraftResult(queryClient, jobId, outcome.result);
    },
  });
}

export function applyDraftResult(
  queryClient: QueryClient,
  jobId: string,
  result: DraftMutationResult
) {
  queryClient.setQueriesData<InfiniteData<JobListPageData, JobListPageParam>>(
    { queryKey: jobsKeys.lists() },
    (data) =>
      data && {
        ...data,
        pages: data.pages.map((page) => ({
          ...page,
          jobs: page.jobs.map((job) =>
            job.id === jobId
              ? { ...job, emailAttempt: null, status: "review" }
              : job
          ),
        })),
      }
  );
  queryClient.setQueryData<JobDetailData>(
    jobsKeys.detail(jobId),
    (data) =>
      data && {
        ...data,
        job: {
          ...data.job,
          draft: {
            ...result.draft,
            attachments: data.job.draft?.attachments ?? [],
          },
          emailAttempt: null,
          status: "review",
        },
      }
  );
}
