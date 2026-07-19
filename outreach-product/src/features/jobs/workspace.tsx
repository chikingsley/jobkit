import { ChevronLeft } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { groupJobsByContact } from "@/features/jobs/job-contact-groups";
import { JobDetail } from "@/features/jobs/job-detail";
import { JobQueueGroup } from "@/features/jobs/job-queue-group";
import { type JobSort, sortJobs } from "@/features/jobs/sorting";
import type { DraftMutationResult, FxData, Job } from "@/features/jobs/types";
import type { QualificationClaimAnswer } from "@/features/matching/claims";
import { useWorkspaceQueryState } from "@/features/workspace/query-state";
import { SplitWorkspace } from "@/features/workspace/split-workspace";
import type { JobMatch, Preferences, Profile } from "@/profile-types";

const INITIAL_VISIBLE_JOBS = 100;

export function JobsWorkspace({
  busy,
  busyClaimKey,
  fx,
  instruction,
  jobs,
  matches,
  onAction,
  onDraftAction,
  onInstruction,
  onQualificationClaim,
  onSelect,
  preferences,
  profile,
  selected,
  sort,
}: {
  busy: string;
  busyClaimKey: string;
  fx: FxData;
  instruction: string;
  jobs: Job[];
  matches: Map<string, JobMatch>;
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
  return (
    <SplitWorkspace
      detail={
        <ScrollArea
          className="min-h-0 flex-1"
          key={selected ? selected.id : "empty"}
        >
          {selected ? (
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
                match={
                  profile && preferences ? matches.get(selected.id) : undefined
                }
                onAction={onAction}
                onDraftAction={onDraftAction}
                onInstruction={onInstruction}
                onQualificationClaim={onQualificationClaim}
              />
            </>
          ) : (
            <div className="grid min-h-[24rem] place-items-center p-8 text-center">
              <div>
                <h2 className="font-semibold">No jobs in this view</h2>
                <p className="mt-1 text-muted-foreground text-sm">
                  Adjust the filters or sync the private board.
                </p>
              </div>
            </div>
          )}
        </ScrollArea>
      }
      detailOpen={detailOpen}
      list={
        <>
          <div className="border-b px-4 py-3">
            <div>
              <h2 className="font-semibold text-sm">Review queue</h2>
              <p className="text-muted-foreground text-xs">
                Showing {queueJobs.length.toLocaleString()} of{" "}
                {jobs.length.toLocaleString()} jobs
              </p>
            </div>
          </div>
          <ScrollArea className="min-h-0 flex-1">
            <div className="p-2">
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
                  selectedId={selected?.id}
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
