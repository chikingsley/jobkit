import { ChevronLeft, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { JobDetail } from "@/features/jobs/job-detail";
import { JobQueueItem } from "@/features/jobs/job-queue-item";
import { type JobSort, sortJobs } from "@/features/jobs/sorting";
import type { FxData, Job } from "@/features/jobs/types";
import type { QualificationClaimAnswer } from "@/features/matching/claims";
import { cn } from "@/lib/utils";
import type { JobMatch, Preferences, Profile } from "@/profile-types";

const fitFilterOptions = [
  { label: "All fit states", value: "all" },
  { label: "Strong match", value: "Strong match" },
  { label: "Likely match", value: "Likely match" },
  { label: "Needs verification", value: "Needs verification" },
  { label: "Preference mismatch", value: "Preference mismatch" },
  { label: "Ineligible", value: "Ineligible" },
];

const sortOptions = [
  {
    label: "Highest USD/hour",
    value: "stated-hourly",
  },
  { label: "Highest monthly USD", value: "monthly-pay" },
  { label: "Original queue order", value: "review-order" },
];

const INITIAL_VISIBLE_JOBS = 100;

export function JobsWorkspace({
  busy,
  busyClaimKey,
  countries,
  countryFilter,
  fitFilter,
  fx,
  instruction,
  jobs,
  matches,
  onAction,
  onCountryFilter,
  onFitFilter,
  onInstruction,
  onQualificationClaim,
  onRefresh,
  onSelect,
  onShowExcluded,
  preferences,
  profile,
  refreshing,
  selected,
  showExcluded,
}: {
  busy: string;
  busyClaimKey: string;
  countries: string[];
  countryFilter: string;
  fitFilter: string;
  fx: FxData;
  instruction: string;
  jobs: Job[];
  matches: Map<string, JobMatch>;
  onAction: (path: string, body?: object) => Promise<void>;
  onCountryFilter: (value: string) => void;
  onFitFilter: (value: string) => void;
  onInstruction: (value: string) => void;
  onQualificationClaim: (input: {
    answer: QualificationClaimAnswer | null;
    claimKey: string;
    kind: string;
    label: string;
  }) => Promise<void>;
  onRefresh: () => Promise<void>;
  onSelect: (id: string) => void;
  onShowExcluded: (value: boolean) => void;
  preferences: Preferences | null;
  profile: Profile | null;
  refreshing: boolean;
  selected?: Job;
  showExcluded: boolean;
}) {
  const [showQueue, setShowQueue] = useState(true);
  const [sort, setSort] = useState<JobSort>("stated-hourly");
  const [visibleLimit, setVisibleLimit] = useState(INITIAL_VISIBLE_JOBS);
  const sortedJobs = useMemo(() => sortJobs(jobs, fx, sort), [fx, jobs, sort]);
  const queueJobs = sortedJobs.slice(0, visibleLimit);
  const countryOptions = [
    { label: "All countries", value: "all" },
    ...countries.map((country) => ({ label: country, value: country })),
  ];
  return (
    <div className="jobs-workspace flex min-h-0 flex-1 overflow-hidden">
      <section
        className={cn(
          "jobs-list-pane h-full min-h-0 w-full flex-col bg-background",
          showQueue ? "flex" : "hidden"
        )}
      >
        <div className="flex items-center justify-between px-4 py-3">
          <div>
            <h2 className="font-semibold text-sm">Review queue</h2>
            <p className="text-muted-foreground text-xs">
              Showing {queueJobs.length.toLocaleString()} of{" "}
              {jobs.length.toLocaleString()} jobs
            </p>
          </div>
          <Button
            aria-label="Refresh jobs"
            onClick={() => void onRefresh()}
            size="icon-sm"
            variant="ghost"
          >
            <RefreshCw className={cn("size-4", refreshing && "animate-spin")} />
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-2 border-y bg-muted/20 p-3">
          <Select
            items={fitFilterOptions}
            onValueChange={(value) => onFitFilter(String(value))}
            value={fitFilter}
          >
            <SelectTrigger className="w-full" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {fitFilterOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <Select
            items={countryOptions}
            onValueChange={(value) => onCountryFilter(String(value))}
            value={countryFilter}
          >
            <SelectTrigger className="w-full" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {countryOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <div className="col-span-2 grid gap-1.5">
            <label className="font-medium text-xs" htmlFor="job-sort">
              Sort jobs
            </label>
            <Select
              items={sortOptions}
              onValueChange={(value) => {
                setSort(String(value) as JobSort);
                setVisibleLimit(INITIAL_VISIBLE_JOBS);
              }}
              value={sort}
            >
              <SelectTrigger id="job-sort" size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {sortOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <p className="text-muted-foreground text-xs">
              Highest to lowest. USD/hour uses only stated pay and stated hours.
            </p>
          </div>
          <div className="col-span-2 flex items-center gap-2 text-muted-foreground text-xs">
            <Checkbox
              aria-label="Show jobs with hard blockers"
              checked={showExcluded}
              onCheckedChange={(value) => onShowExcluded(Boolean(value))}
            />
            Show jobs with hard blockers
          </div>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <div className="p-2">
            {queueJobs.map((job) => (
              <JobQueueItem
                active={job.id === selected?.id}
                fx={fx}
                job={job}
                key={job.id}
                match={matches.get(job.id)}
                onSelect={() => {
                  onSelect(job.id);
                  setShowQueue(false);
                }}
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
      </section>
      <ScrollArea
        className={cn(
          "jobs-detail-pane min-h-0 flex-1 bg-muted/20",
          showQueue ? "hidden" : "block"
        )}
        key={selected ? selected.id : "empty"}
      >
        {selected ? (
          <>
            <div className="jobs-back border-b bg-background px-4 py-2">
              <Button onClick={() => setShowQueue(true)} variant="ghost">
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
    </div>
  );
}
