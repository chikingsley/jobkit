import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { selectVisibleJob } from "@/features/jobs/filters";
import { JobToolbar } from "@/features/jobs/job-toolbar";
import { PRIVATE_JOB_PAGE_SIZE } from "@/features/jobs/list-query";
import type { DraftMutationResult } from "@/features/jobs/types";
import { JobsWorkspace } from "@/features/jobs/workspace";
import { useWorkspaceContext } from "@/features/workspace/context";
import { useJobsQueryState } from "@/features/workspace/query-state";
import { apiRequest } from "@/lib/api";

export function JobsRouteToolbar() {
  const { countries, loadJob, loadJobs, refreshing } = useWorkspaceContext();
  const {
    countryFilter,
    fitFilter,
    selectedJobId,
    setCountryFilter,
    setFitFilter,
    setShowExcluded,
    setSort,
    showExcluded,
    sort,
  } = useJobsQueryState();
  const { jobs } = useWorkspaceContext();
  const selected = selectVisibleJob(jobs, selectedJobId);
  const refreshJobs = useCallback(async () => {
    await loadJobs();
    if (selected) {
      await loadJob(selected.id);
    }
  }, [loadJob, loadJobs, selected]);

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
      refreshing={refreshing}
      showExcluded={showExcluded}
      sort={sort}
    />
  );
}

export function JobsRoute() {
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState("");
  const {
    applyDraftMutation,
    busyClaimKey,
    fx,
    jobDetailError,
    jobDetailLoading,
    jobDetails,
    jobPage,
    jobs,
    jobsError,
    loadJob,
    loadJobs,
    loadMoreJobs,
    matches,
    preferences,
    profile,
    refreshing,
    saveQualificationClaim,
  } = useWorkspaceContext();
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

  useEffect(() => {
    void loadJobs({
      query: {
        country: countryFilter,
        excludeBoard: "anesl",
        fit: fitFilter,
        limit: PRIVATE_JOB_PAGE_SIZE,
        offset: 0,
        publicJob: publicJobIntent,
        showExcluded,
        sort,
      },
    }).catch(() => undefined);
  }, [countryFilter, fitFilter, loadJobs, publicJobIntent, showExcluded, sort]);

  const intendedJob = publicJobIntent
    ? jobs.find((job) => job.publicJobId === publicJobIntent)
    : undefined;
  const selectedListItem = publicJobIntent
    ? intendedJob
    : selectVisibleJob(jobs, selectedJobId);
  const selectedDetailId = intendedJob?.id ?? selectedJobId;
  const selectedDetail = selectedDetailId
    ? jobDetails.get(selectedDetailId)
    : undefined;
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

  useEffect(() => {
    if (
      !selectedDetailId ||
      selectedDetail ||
      jobDetailLoading === selectedDetailId
    ) {
      return;
    }
    void loadJob(selectedDetailId).catch(() => undefined);
  }, [jobDetailLoading, loadJob, selectedDetail, selectedDetailId]);

  async function action(path: string, body?: object) {
    if (!selected) {
      return;
    }
    setBusy(path);
    try {
      const response = await apiRequest(path, {
        body: body ? JSON.stringify(body) : undefined,
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const result = (await response.json()) as {
        message?: string;
        ok: boolean;
      };
      setInstruction("");
      await loadJobs({ quiet: true });
      await loadJob(selected.id);
      toast.success(result.message ?? "Workspace updated");
    } catch (error) {
      await loadJobs({ quiet: true }).catch(() => undefined);
      toast.error(error instanceof Error ? error.message : "Request failed");
    } finally {
      setBusy("");
    }
  }

  async function draftAction(
    path: string,
    options: { body?: object; method?: "POST" | "PUT" }
  ): Promise<DraftMutationResult | null> {
    if (!selected) {
      return null;
    }
    setBusy(path);
    try {
      const response = await apiRequest(path, {
        body: options.body ? JSON.stringify(options.body) : undefined,
        headers: { "content-type": "application/json" },
        method: options.method ?? "POST",
      });
      if (response.status === 202) {
        const queued = (await response.json()) as {
          notice: string;
          ok: true;
        };
        setInstruction("");
        await loadJobs({ quiet: true });
        await loadJob(selected.id);
        toast.success(queued.notice);
        return null;
      }
      const result = (await response.json()) as DraftMutationResult;
      applyDraftMutation(selected.id, result);
      setInstruction("");
      toast.success(result.notice);
      return result;
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Draft update failed"
      );
      return null;
    } finally {
      setBusy("");
    }
  }

  return (
    <JobsWorkspace
      busy={busy}
      busyClaimKey={busyClaimKey}
      detailOpen={detailOpen || Boolean(publicJobIntent)}
      fx={fx}
      hasMore={jobPage.hasMore}
      instruction={instruction}
      jobDetailError={jobDetailError}
      jobDetailLoading={
        jobDetailLoading !== "" && jobDetailLoading === selectedDetailId
      }
      jobs={jobs}
      jobsError={jobsError}
      jobsLoading={refreshing && jobs.length === 0}
      matches={matches}
      onAction={action}
      onCloseDetail={closeDetail}
      onDraftAction={draftAction}
      onInstruction={setInstruction}
      onLoadMore={loadMoreJobs}
      onQualificationClaim={saveQualificationClaim}
      onSelect={openJob}
      preferences={preferences}
      profile={profile}
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
