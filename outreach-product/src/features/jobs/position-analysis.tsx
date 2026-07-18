import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { humanize } from "@/features/jobs/format";
import type { JobPositionAnalysis } from "@/features/jobs/position-variants";

export function PositionAnalysis({
  analysis,
}: {
  analysis: JobPositionAnalysis;
}) {
  return (
    <Card className="mt-5">
      <CardHeader>
        <CardTitle>Advertised positions</CardTitle>
        <CardDescription>
          Distinct roles found in this listing. Matching uses each role rather
          than treating the whole post as one job.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {analysis.positions.map((position) => (
          <div
            className="rounded-lg border bg-muted/20 p-3"
            key={`${position.title}:${position.evidence[0]}`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-medium text-sm">{position.title}</h3>
              <Badge
                variant={
                  position.roleFamily === "subject_specialist"
                    ? "destructive"
                    : "outline"
                }
              >
                {humanize(position.roleFamily)}
              </Badge>
              {position.certainty === "ambiguous" ? (
                <Badge variant="secondary">Ambiguous</Badge>
              ) : null}
            </div>
            {position.subjects.length > 0 ? (
              <p className="mt-2 text-muted-foreground text-xs">
                Subjects:{" "}
                {position.subjects.map(({ value }) => value).join(", ")}
              </p>
            ) : null}
            <p className="mt-2 text-muted-foreground text-xs leading-5">
              {position.evidence.join(" · ")}
            </p>
          </div>
        ))}
        {analysis.reviewNotes.map((note) => (
          <p className="text-muted-foreground text-xs" key={note}>
            {note}
          </p>
        ))}
      </CardContent>
    </Card>
  );
}
