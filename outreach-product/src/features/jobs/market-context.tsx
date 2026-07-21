import { AlertTriangle } from "lucide-react";
import type { Job } from "@/features/jobs/types";
import {
  marketSegmentLabels,
  restrictedMarketSegments,
} from "@/features/organizations/market-segments";

export function JobMarketContext({ job }: { job: Job }) {
  const restricted = job.marketSegments.filter((segment) =>
    restrictedMarketSegments.has(segment)
  );
  if (restricted.length === 0) {
    return null;
  }
  return (
    <p className="mt-5 flex gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-destructive text-sm leading-5">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      Includes{" "}
      {restricted.map((segment) => marketSegmentLabels[segment]).join(" and ")}{" "}
      placements.
    </p>
  );
}
