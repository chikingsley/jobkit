import { ChevronLeft } from "lucide-react";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { groupJobsByContact } from "@/features/jobs/job-contact-groups";
import { JobDetail } from "@/features/jobs/job-detail";
import { JobQueueGroup } from "@/features/jobs/job-queue-group";
import type {
  DraftMutationResult,
  FxData,
  Job,
  JobListItem,
} from "@/features/jobs/types";
import type { QualificationClaimAnswer } from "@/features/matching/claims";
import { SplitWorkspace } from "@/features/workspace/split-workspace";
import type {
  JobMatch,
  JobMatchSummary,
  Preferences,
  Profile,
} from "@/profile-types";

const JOB_LOADING_ROWS = ["first", "second", "third", "fourth", "fifth"];

export function JobsWorkspace({
  busy,
  busyClaimKey,
  detailOpen,
  fx,
  hasMore,
  instruction,
  jobDetailError,
  jobDetailLoading,
  jobs,
  jobsError,
  jobsLoading,
  matches,
  onAction,
  onCloseDetail,
  onDraftAction,
  onInstruction,
  onLoadMore,
  onQualificationClaim,
  onSelect,
  preferences,
  profile,
  selected,
  selectedId,
  selectedMatch,
  selectionNotice,
  totalCount,
}: {
  busy: string;
  busyClaimKey: string;
  detailOpen: boolean;
  fx: FxData;
  hasMore: boolean;
  instruction: string;
  jobDetailError: string;
  jobDetailLoading: boolean;
  jobs: JobListItem[];
  jobsError: string;
  jobsLoading: boolean;
  matches: ReadonlyMap<string, JobMatchSummary>;
  onAction: (path: string, body?: object) => Promise<void>;
  onCloseDetail: () => void;
  onDraftAction: (
    path: string,
    options: { body?: object; method?: "POST" | "PUT" }
  ) => Promise<DraftMutationResult | null>;
  onInstruction: (value: string) => void;
  onLoadMore: () => Promise<void>;
  onQualificationClaim: (input: {
    answer: QualificationClaimAnswer | null;
    claimKey: string;
    kind: string;
    label: string;
  }) => Promise<void>;
  onSelect: (id: string) => Promise<void>;
  preferences: Preferences | null;
  profile: Profile | null;
  selected?: Job;
  selectedId?: string;
  selectedMatch?: JobMatch;
  selectionNotice?: { message: string; title: string };
  totalCount: number;
}) {
  const queueGroups = useMemo(() => groupJobsByContact(jobs), [jobs]);
  const detailContent = renderJobDetail({
    busy,
    busyClaimKey,
    fx,
    instruction,
    jobDetailError,
    jobDetailLoading,
    onAction,
    onCloseDetail,
    onDraftAction,
    onInstruction,
    onQualificationClaim,
    preferences,
    profile,
    selected,
    selectedId,
    selectedMatch,
    selectionNotice,
  });
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
            {jobsLoading ? (
              <Skeleton className="h-3 w-20" />
            ) : (
              <p className="text-muted-foreground text-xs">
                {hasMore
                  ? `${jobs.length.toLocaleString()} of ${totalCount.toLocaleString()} jobs`
                  : `${totalCount.toLocaleString()} jobs`}
              </p>
            )}
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
                  onSelect={(jobId) => void onSelect(jobId)}
                  selectedId={selectedId}
                />
              ))}
              {hasMore ? (
                <Button
                  className="mt-2 w-full"
                  onClick={() => void onLoadMore()}
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

function renderJobDetail(input: {
  busy: string;
  busyClaimKey: string;
  fx: FxData;
  instruction: string;
  jobDetailError: string;
  jobDetailLoading: boolean;
  onAction: (path: string, body?: object) => Promise<void>;
  onCloseDetail: () => void;
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
  preferences: Preferences | null;
  profile: Profile | null;
  selected?: Job;
  selectedId?: string;
  selectedMatch?: JobMatch;
  selectionNotice?: { message: string; title: string };
}) {
  if (input.selected) {
    return (
      <>
        <DetailBackButton onClose={input.onCloseDetail} />
        <JobDetail
          busy={input.busy}
          busyClaimKey={input.busyClaimKey}
          fx={input.fx}
          instruction={input.instruction}
          job={input.selected}
          match={
            input.profile && input.preferences ? input.selectedMatch : undefined
          }
          onAction={input.onAction}
          onDraftAction={input.onDraftAction}
          onInstruction={input.onInstruction}
          onQualificationClaim={input.onQualificationClaim}
        />
      </>
    );
  }
  if (input.jobDetailLoading) {
    return <JobDetailLoading />;
  }
  if (input.selectedId && input.jobDetailError) {
    return (
      <WorkspaceError
        message={input.jobDetailError}
        title="Job details could not load"
      />
    );
  }
  if (input.selectionNotice) {
    return (
      <>
        <DetailBackButton onClose={input.onCloseDetail} />
        <WorkspaceError
          message={input.selectionNotice.message}
          title={input.selectionNotice.title}
        />
      </>
    );
  }
  return (
    <div className="grid min-h-[24rem] place-items-center p-8 text-center">
      <div>
        <h2 className="font-semibold">No jobs in this view</h2>
        <p className="mt-1 text-muted-foreground text-sm">
          Adjust the filters or sync the private board.
        </p>
      </div>
    </div>
  );
}

function DetailBackButton({ onClose }: { onClose: () => void }) {
  return (
    <div className="split-workspace-back border-b bg-background px-4 py-2">
      <Button onClick={onClose} variant="ghost">
        <ChevronLeft /> Jobs
      </Button>
    </div>
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
