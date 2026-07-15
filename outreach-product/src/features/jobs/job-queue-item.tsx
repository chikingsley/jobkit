import { ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { compensationDisplay } from "@/features/jobs/compensation";
import { humanize } from "@/features/jobs/format";
import { MatchBadge } from "@/features/jobs/match";
import type { FxData, Job } from "@/features/jobs/types";
import { cn } from "@/lib/utils";
import type { JobMatch } from "@/profile-types";

function currentEmailStatus(job: Job) {
  const attempt = job.emailAttempt;
  if (!attempt) {
    return;
  }
  if (
    attempt.sendRequestedAt &&
    ["approved", "claimed", "drafted", "sending"].includes(attempt.status)
  ) {
    return "sending";
  }
  return attempt.status;
}

export function JobQueueItem({
  active,
  fx,
  job,
  match,
  onSelect,
}: {
  active: boolean;
  fx: FxData;
  job: Job;
  match?: JobMatch;
  onSelect: () => void;
}) {
  const salary = compensationDisplay(job.compensation, fx);
  const emailStatus = currentEmailStatus(job);
  return (
    <button
      className={cn(
        "group relative mb-1 w-full rounded-lg border border-transparent p-3 text-left transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active && "border-primary/30 bg-accent shadow-sm hover:bg-accent"
      )}
      onClick={onSelect}
      type="button"
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <MatchBadge match={match} />
            {job.status === "new" ? null : (
              <Badge variant="outline">{humanize(job.status)}</Badge>
            )}
            {emailStatus ? (
              <Badge variant="secondary">Email {humanize(emailStatus)}</Badge>
            ) : null}
            {job.opportunityScope === "multi_position" ? (
              <Badge variant="outline">Multiple positions</Badge>
            ) : null}
            {job.marketSegments.some(
              (segment) =>
                segment === "training_center" || segment === "language_center"
            ) ? (
              <Badge variant="destructive">Center placements</Badge>
            ) : null}
          </div>
          <h3 className="mt-2 line-clamp-2 font-semibold text-sm leading-snug">
            {job.title}
          </h3>
          <p className="mt-1 truncate text-muted-foreground text-xs">
            {job.company || "Employer not named"}
          </p>
          <p className="mt-2 text-muted-foreground text-xs">
            {[job.location, job.country].filter(Boolean).join(" · ")}
          </p>
          <p className="mt-1 truncate font-medium text-xs">
            {salary.usd ?? salary.primary}
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
