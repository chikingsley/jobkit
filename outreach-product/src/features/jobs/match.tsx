import { CheckCircle2, CircleHelp, Minus, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { JobMatch, MatchState } from "@/profile-types";

export function MatchBadge({ match }: { match?: JobMatch }) {
  return (
    <Badge className={matchBadgeClass(match?.tone)} variant="outline">
      {match?.label ?? "Evaluating…"}
    </Badge>
  );
}

export function MatchPanel({ match }: { match: JobMatch }) {
  const matched = match.criteria.filter(
    (item) => item.state === "match"
  ).length;
  const blockers = match.criteria.filter(
    (item) => item.state === "conflict"
  ).length;
  const unknown = match.criteria.filter(
    (item) => item.state === "unknown"
  ).length;
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardDescription>Candidate fit</CardDescription>
            <CardTitle className="mt-1">{match.label}</CardTitle>
          </div>
          <p className="text-muted-foreground text-xs">
            {matched} matched · {blockers} blockers · {unknown} unknown
          </p>
        </div>
      </CardHeader>
      <CardContent className="grid gap-2 sm:grid-cols-2">
        {match.criteria.map((item) => (
          <div
            className="flex items-start gap-2 rounded-lg border bg-muted/20 p-3 text-sm"
            key={item.label}
          >
            <CriterionIcon state={item.state} />
            <span className="leading-5">{item.label}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function CriterionIcon({ state }: { state: MatchState }) {
  if (state === "match") {
    return <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />;
  }
  if (state === "conflict") {
    return <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />;
  }
  if (state === "preference") {
    return <Minus className="mt-0.5 size-4 shrink-0 text-amber-600" />;
  }
  return (
    <CircleHelp className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
  );
}

function matchBadgeClass(tone?: JobMatch["tone"]) {
  if (tone === "positive") {
    return "border-emerald-600/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  }
  if (tone === "warning") {
    return "border-amber-600/20 bg-amber-500/10 text-amber-700 dark:text-amber-300";
  }
  if (tone === "negative") {
    return "border-destructive/20 bg-destructive/10 text-destructive";
  }
  return "bg-muted text-muted-foreground";
}
