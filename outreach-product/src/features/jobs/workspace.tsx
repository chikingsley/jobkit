import { ChevronLeft } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { groupJobsByContact } from "@/features/jobs/job-contact-groups";
import { JobDetail } from "@/features/jobs/job-detail";
import { JobQueueGroup } from "@/features/jobs/job-queue-group";
import { type JobSort, sortJobs } from "@/features/jobs/sorting";
import type {
  DraftMutationResult,
  FxData,
  Job,
  JobListItem,
} from "@/features/jobs/types";
import type { QualificationClaimAnswer } from "@/features/matching/claims";
import { useWorkspaceQueryState } from "@/features/workspace/query-state";
import { SplitWorkspace } from "@/features/workspace/split-workspace";
import type {
  JobMatch,
  JobMatchSummary,
  Preferences,
  Profile,
} from "@/profile-types";

const INITIAL_VISIBLE_JOBS = 100;
const JOB_LOADING_ROWS = ["first", "second", "third", "fourth", "fifth"];

export function JobsWorkspace({
  busy,
  busyClaimKey,
  fx,
  instruction,
  jobDetailError,
  jobDetailLoading,
  jobs,
  jobsError,
  jobsLoading,
  matches,
  onAction,
  onDraftAction,
  onInstruction,
  onQualificationClaim,
  onSelect,
  preferences,
  profile,
  selected,
  selectedId,
  selectedMatch,
  sort,
}: {
  busy: string;
  busyClaimKey: string;
  fx: FxData;
  instruction: string;
  jobDetailError: string;
  jobDetailLoading: boolean;
  jobs: JobListItem[];
  jobsError: string;
  jobsLoading: boolean;
  matches: Map<string, JobMatchSummary>;
  onAction: (path: string, body?: object) => Promise<void>;
  onDraftAction: (
    path: string,
    options: { body?: object; method?: "POST" | "PUT" }
  ) => Promise<DraftMutationResult | null>;
  onInstruction: (value: string) => void;
  onQualificationClaim: (input: {
    answer: QualificationClaimAnswer | null;
    claimKey: string;
    kind: string;
    label: string;
  }) => Promise<void>;
  onSelect: (id: string) => void;
  preferences: Preferences | null;
  profile: Profile | null;
  selected?: Job;
  selectedId?: string;
  selectedMatch?: JobMatch;
  sort: JobSort;
}) {
  const { detailOpen, setDetailOpen } = useWorkspaceQueryState();
  const [visibleLimit, setVisibleLimit] = useState(INITIAL_VISIBLE_JOBS);
  const sortedJobs = useMemo(() => sortJobs(jobs, fx, sort), [fx, jobs, sort]);
  const queueJobs = sortedJobs.slice(0, visibleLimit);
  const queueGroups = useMemo(
    () => groupJobsByContact(sortedJobs.slice(0, visibleLimit)),
    [sortedJobs, visibleLimit]
  );
  let detailContent = (
    <div className="grid min-h-[24rem] place-items-center p-8 text-center">
      <div>
        <h2 className="font-semibold">No jobs in this view</h2>
        <p className="mt-1 text-muted-foreground text-sm">
          Adjust the filters or sync the private board.
        </p>
      </div>
    </div>
  );
  if (selected) {
    detailContent = (
      <>
        <div className="split-workspace-back border-b bg-background px-4 py-2">
          <Button onClick={() => setDetailOpen(false)} variant="ghost">
            <ChevronLeft /> Review queue
          </Button>
        </div>
        <JobDetail
          busy={busy}
          busyClaimKey={busyClaimKey}
          fx={fx}
          instruction={instruction}
          job={selected}
          match={profile && preferences ? selectedMatch : undefined}
          onAction={onAction}
          onDraftAction={onDraftAction}
          onInstruction={onInstruction}
          onQualificationClaim={onQualificationClaim}
        />
      </>
    );
  } else if (jobDetailLoading) {
    detailContent = <JobDetailLoading />;
  } else if (selectedId && jobDetailError) {
    detailContent = (
      <WorkspaceError
        message={jobDetailError}
        title="Job details could not load"
      />
    );
  }
  return (
    <SplitWorkspace
      detail={
        <ScrollArea
          className="min-h-0 flex-1"
          key={selected ? selected.id : "empty"}
        >
          {detailContent}
        </ScrollArea>
      }
      detailOpen={detailOpen}
      list={
        <>
          <div className="border-b px-4 py-3">
            <div>
              <h2 className="font-semibold text-sm">Review queue</h2>
              {jobsLoading ? (
                <Skeleton className="mt-1 h-3 w-28" />
              ) : (
                <p className="text-muted-foreground text-xs">
                  Showing {queueJobs.length.toLocaleString()} of{" "}
                  {jobs.length.toLocaleString()} jobs
                </p>
              )}
            </div>
          </div>
          <ScrollArea className="min-h-0 flex-1">
            <div className="p-2">
              {jobsLoading ? <JobQueueLoading /> : null}
              {!jobsLoading && jobsError ? (
                <WorkspaceError
                  message={jobsError}
                  title="Jobs could not load"
                />
              ) : null}
              {queueGroups.map((group) => (
                <JobQueueGroup
                  fx={fx}
                  group={group}
                  key={group.id}
                  matches={matches}
                  onSelect={(jobId) => {
                    onSelect(jobId);
                    setDetailOpen(true);
                  }}
                  selectedId={selectedId}
                />
              ))}
              {queueJobs.length < sortedJobs.length ? (
                <Button
                  className="mt-2 w-full"
                  onClick={() =>
                    setVisibleLimit((current) => current + INITIAL_VISIBLE_JOBS)
                  }
                  variant="outline"
                >
                  Show 100 more
                </Button>
              ) : null}
            </div>
          </ScrollArea>
        </>
      }
    />
  );
}

function JobQueueLoading() {
  return (
    <div aria-label="Loading jobs" className="grid gap-2 p-1" role="status">
      {JOB_LOADING_ROWS.map((row) => (
        <div className="rounded-lg border p-3" key={row}>
          <Skeleton className="h-5 w-24" />
          <Skeleton className="mt-3 h-4 w-4/5" />
          <Skeleton className="mt-2 h-3 w-3/5" />
          <Skeleton className="mt-4 h-3 w-2/5" />
        </div>
      ))}
    </div>
  );
}

function JobDetailLoading() {
  return (
    <div
      aria-label="Loading job details"
      className="grid gap-6 p-6"
      role="status"
    >
      <div>
        <Skeleton className="h-7 w-3/5" />
        <Skeleton className="mt-3 h-4 w-2/5" />
      </div>
      <Skeleton className="h-28 w-full" />
      <Skeleton className="h-48 w-full" />
    </div>
  );
}

function WorkspaceError({
  message,
  title,
}: {
  message: string;
  title: string;
}) {
  return (
    <div className="grid min-h-48 place-items-center p-6 text-center">
      <div className="max-w-sm">
        <h2 className="font-semibold">{title}</h2>
        <p className="mt-1 text-muted-foreground text-sm">{message}</p>
      </div>
    </div>
  );
}
