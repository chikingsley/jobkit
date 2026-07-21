import { humanize } from "@/features/jobs/format";
import type { JobPositionAnalysis } from "@/features/jobs/position-variants";

export function PositionAnalysis({
  analysis,
}: {
  analysis: JobPositionAnalysis;
}) {
  if (analysis.positions.length <= 1) {
    return null;
  }
  return (
    <section className="mt-7 border-t pt-6">
      <h3 className="font-semibold text-sm">
        Positions ({analysis.positions.length})
      </h3>
      <div className="mt-3 divide-y">
        {analysis.positions.map((position) => (
          <div
            className="py-3"
            key={`${position.title}:${position.evidence[0]}`}
          >
            <h4 className="font-medium text-sm">{position.title}</h4>
            <p className="mt-1 text-muted-foreground text-xs leading-5">
              {[
                humanize(position.roleFamily),
                position.subjects.length > 0
                  ? position.subjects.map(({ value }) => value).join(", ")
                  : null,
                position.certainty === "ambiguous" ? "Details vary" : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
