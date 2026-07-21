import { ChevronRight } from "lucide-react";
import { createJobDisplayFacts } from "@/features/jobs/display-facts";
import type { FxData, JobListItem } from "@/features/jobs/types";
import { cn } from "@/lib/utils";
import type { JobMatchSummary } from "@/profile-types";

export function JobQueueItem({
  active,
  fx,
  job,
  match,
  onSelect,
}: {
  active: boolean;
  fx: FxData;
  job: JobListItem;
  match?: JobMatchSummary;
  onSelect: () => void;
}) {
  const facts = createJobDisplayFacts(job, fx, match);
  return (
    <button
      className={cn(
        "group relative mb-1 min-h-11 w-full rounded-lg border border-transparent p-3 text-left transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active && "border-primary/30 bg-accent shadow-sm hover:bg-accent"
      )}
      onClick={onSelect}
      type="button"
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="line-clamp-2 font-semibold text-sm leading-snug">
            {job.title}
          </h3>
          <p className="mt-1 truncate text-muted-foreground text-xs">
            {facts.employer}
          </p>
          <p className="mt-1 truncate text-muted-foreground text-xs">
            {facts.location}
          </p>
          <p className="mt-2 truncate font-medium text-xs">
            {facts.compensationPrimary}
          </p>
          {facts.compensationSecondary.length > 0 ? (
            <p className="mt-1 truncate text-muted-foreground text-xs">
              {facts.compensationSecondary.join(" · ")}
            </p>
          ) : null}
          <p className="mt-2 truncate text-foreground/80 text-xs">
            {[facts.matchSummary, facts.positionSummary, facts.applicationState]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <ChevronRight
          className={cn(
            "mt-1 size-4 shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5",
            active && "text-primary"
          )}
        />
      </div>
    </button>
  );
}
