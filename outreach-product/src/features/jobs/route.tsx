import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { selectVisibleJob } from "@/features/jobs/filters";
import { JobToolbar } from "@/features/jobs/job-toolbar";
import {
  flattenJobPages,
  latestJobListMeta,
  mergeJobMatches,
} from "@/features/jobs/list-pages";
import { jobListFilters } from "@/features/jobs/list-query";
import {
  jobsKeys,
  useDraftAction,
  useJobAction,
  useJobDetail,
  useJobList,
} from "@/features/jobs/queries";
import type { DraftMutationResult } from "@/features/jobs/types";
import { JobsWorkspace } from "@/features/jobs/workspace";
import { usePreferences } from "@/features/preferences/queries";
import { useProfile } from "@/features/profile/queries";
import { useJobsQueryState } from "@/features/workspace/query-state";
import {
  type QualificationClaimInput,
  useQualificationClaimMutation,
} from "@/pipeline/03_match/queries";

export function JobsRouteToolbar() {
  const queryClient = useQueryClient();
  const {
    countryFilter,
    fitFilter,
    publicJobIntent,
    setCountryFilter,
    setFitFilter,
    setShowExcluded,
    setSort,
    showExcluded,
    sort,
  } = useJobsQueryState();
  const filters = jobListFilters({
    country: countryFilter,
    fit: fitFilter,
    publicJob: publicJobIntent,
    showExcluded,
    sort,
  });
  const listQuery = useJobList(filters);
  const { countries } = latestJobListMeta(listQuery.data?.pages ?? []);
  const refreshJobs = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: jobsKeys.all });
  }, [queryClient]);

  return (
    <JobToolbar
      countries={countries}
      countryFilter={countryFilter}
      fitFilter={fitFilter}
      onCountryFilter={setCountryFilter}
      onFitFilter={setFitFilter}
      onRefresh={refreshJobs}
      onShowExcluded={setShowExcluded}
      onSort={setSort}
      refreshing={listQuery.isFetching}
      showExcluded={showExcluded}
      sort={sort}
    />
  );
}

export function JobsRoute() {
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState("");
  const {
    closeDetail,
    countryFilter,
    detailOpen,
    fitFilter,
    openJob,
    publicJobIntent,
    resolvePublicJobIntent,
    selectedJobId,
    setSelectedJobId,
    showExcluded,
    sort,
  } = useJobsQueryState();
  const filters = jobListFilters({
    country: countryFilter,
    fit: fitFilter,
    publicJob: publicJobIntent,
    showExcluded,
    sort,
  });
  const listQuery = useJobList(filters);
  const pages = listQuery.data?.pages;
  const jobs = useMemo(() => flattenJobPages(pages ?? []), [pages]);
  const matches = useMemo(() => mergeJobMatches(pages ?? []), [pages]);
  const { fx, page: jobPage } = latestJobListMeta(pages ?? []);
  const profileQuery = useProfile();
  const preferencesQuery = usePreferences();
  const claimMutation = useQualificationClaimMutation();
  const jobAction = useJobAction();
  const refreshing = listQuery.isFetching;

  const intendedJob = publicJobIntent
    ? jobs.find((job) => job.publicJobId === publicJobIntent)
    : undefined;
  const selectedListItem = publicJobIntent
    ? intendedJob
    : selectVisibleJob(jobs, selectedJobId);
  const selectedDetailId = intendedJob?.id ?? selectedJobId;
  const detailQuery = useJobDetail(selectedDetailId);
  const draftAction = useDraftAction(selectedDetailId);
  const selectedDetail = detailQuery.data;
  const selected = selectedDetail?.job;

  useEffect(() => {
    if (publicJobIntent && intendedJob) {
      void resolvePublicJobIntent(intendedJob.id);
      return;
    }
    if (!(publicJobIntent || selectedJobId) && selectedListItem) {
      void setSelectedJobId(selectedListItem.id);
    }
  }, [
    intendedJob,
    publicJobIntent,
    resolvePublicJobIntent,
    selectedJobId,
    selectedListItem,
    setSelectedJobId,
  ]);

  async function action(path: string, body?: object) {
    if (!selected) {
      return;
    }
    setBusy(path);
    try {
      const result = await jobAction.mutateAsync({ body, path });
      setInstruction("");
      toast.success(result.message ?? "Workspace updated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Request failed");
    } finally {
      setBusy("");
    }
  }

  async function runDraftAction(
    path: string,
    options: { body?: object; method?: "POST" | "PUT" }
  ): Promise<DraftMutationResult | null> {
    if (!selected) {
      return null;
    }
    setBusy(path);
    try {
      const outcome = await draftAction.mutateAsync({
        body: options.body,
        method: options.method,
        path,
      });
      setInstruction("");
      if (outcome.kind === "queued") {
        toast.success(outcome.notice);
        return null;
      }
      toast.success(outcome.result.notice);
      return outcome.result;
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Draft update failed"
      );
      return null;
    } finally {
      setBusy("");
    }
  }

  async function saveQualificationClaim(input: QualificationClaimInput) {
    try {
      await claimMutation.mutateAsync(input);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Qualification answer failed"
      );
    }
  }

  return (
    <JobsWorkspace
      busy={busy}
      busyClaimKey={
        claimMutation.isPending && claimMutation.variables
          ? claimMutation.variables.claimKey
          : ""
      }
      detailOpen={detailOpen || Boolean(publicJobIntent)}
      fx={fx}
      hasMore={jobPage.hasMore}
      instruction={instruction}
      jobDetailError={detailQuery.error?.message ?? ""}
      jobDetailLoading={detailQuery.isLoading}
      jobs={jobs}
      jobsError={listQuery.error?.message ?? ""}
      jobsLoading={refreshing && jobs.length === 0}
      matches={matches}
      onAction={action}
      onCloseDetail={closeDetail}
      onDraftAction={runDraftAction}
      onInstruction={setInstruction}
      onLoadMore={async () => {
        if (listQuery.hasNextPage && !listQuery.isFetchingNextPage) {
          await listQuery.fetchNextPage();
        }
      }}
      onQualificationClaim={saveQualificationClaim}
      onSelect={openJob}
      preferences={preferencesQuery.data ?? null}
      profile={profileQuery.data ?? null}
      selected={selected}
      selectedId={selectedDetailId}
      selectedMatch={selectedDetail?.match}
      selectionNotice={
        publicJobIntent && !refreshing && !intendedJob
          ? {
              message:
                "Your selected job remains in the URL. Refresh after its private application mapping completes.",
              title: "Application route is being prepared",
            }
          : undefined
      }
      totalCount={jobPage.totalCount}
    />
  );
}
