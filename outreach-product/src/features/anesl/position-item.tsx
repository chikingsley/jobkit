import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { compensationDisplay } from "@/features/jobs/compensation";
import { MatchBadge } from "@/features/jobs/match";
import type { FxData, Job } from "@/features/jobs/types";
import type { JobMatch } from "@/profile-types";

export function AneslPositionItem({
  checked,
  disabled,
  fx,
  job,
  match,
  onCheckedChange,
}: {
  checked: boolean;
  disabled: boolean;
  fx: FxData;
  job: Job;
  match?: JobMatch;
  onCheckedChange: (checked: boolean) => void;
}) {
  const salary = compensationDisplay(job.compensation, fx);
  const checkboxId = `anesl-position-${job.id}`;
  return (
    <div className="group flex items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/50 has-data-checked:border-primary/40 has-data-checked:bg-accent/50">
      <Checkbox
        aria-label={`Select ${job.sourceReference}`}
        checked={checked}
        disabled={disabled}
        id={checkboxId}
        onCheckedChange={onCheckedChange}
      />
      <label className="min-w-0 flex-1 cursor-pointer" htmlFor={checkboxId}>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline">{job.sourceReference}</Badge>
          <MatchBadge match={match} />
          {job.marketSegments.some(
            (segment) =>
              segment === "training_center" || segment === "language_center"
          ) ? (
            <Badge variant="destructive">Center</Badge>
          ) : null}
        </div>
        <h3 className="mt-2 line-clamp-2 font-medium text-sm leading-snug">
          {job.title}
        </h3>
        <p className="mt-1 truncate text-muted-foreground text-xs">
          {[job.location, salary.usd ?? salary.primary]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </label>
      <a
        aria-label={`Open ${job.sourceReference} on ANESL`}
        className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        href={job.sourceUrl}
        rel="noreferrer"
        target="_blank"
      >
        <ExternalLink className="size-4" />
      </a>
    </div>
  );
}
