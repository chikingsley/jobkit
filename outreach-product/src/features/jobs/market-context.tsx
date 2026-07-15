import { AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { Job, MarketSegment } from "@/features/jobs/types";

const segmentLabels: Record<MarketSegment, string> = {
  international_school: "International school",
  kindergarten: "Kindergarten",
  language_center: "Language center",
  online: "Online",
  private_school: "Private school",
  public_school: "Public school",
  school: "School",
  training_center: "Training center",
  university: "University",
};
const restrictedSegments = new Set<MarketSegment>([
  "language_center",
  "training_center",
]);

export function JobMarketContext({ job }: { job: Job }) {
  const restricted = job.marketSegments.filter((segment) =>
    restrictedSegments.has(segment)
  );
  if (job.opportunityScope === "unknown" && job.marketSegments.length === 0) {
    return null;
  }
  return (
    <div className="mt-4 rounded-lg border bg-background p-3 text-sm">
      <div className="flex flex-wrap gap-1.5">
        {job.opportunityScope === "multi_position" ? (
          <Badge variant="secondary">Multiple positions</Badge>
        ) : null}
        {job.opportunityScope === "direct" ? (
          <Badge variant="secondary">Direct role</Badge>
        ) : null}
        {job.marketSegments.map((segment) => (
          <Badge
            key={segment}
            variant={
              restrictedSegments.has(segment) ? "destructive" : "outline"
            }
          >
            {segmentLabels[segment]}
          </Badge>
        ))}
      </div>
      {restricted.length ? (
        <p className="mt-2 flex gap-2 text-destructive text-xs leading-5">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          Includes{" "}
          {restricted.map((segment) => segmentLabels[segment]).join(" and ")}{" "}
          placements. Listings limited to these segments are excluded from the
          normal queue.
        </p>
      ) : null}
    </div>
  );
}
