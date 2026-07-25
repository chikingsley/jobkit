import { Check, Copy, RotateCcw, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { TestLabRun } from "@/features/test-lab/types";

export function TestLabRunResult({
  onReplay,
  run,
}: {
  onReplay?: () => void;
  run: TestLabRun;
}) {
  const { metrics } = run;
  const { score } = metrics;
  const latency =
    metrics.codexLatencyMs ?? metrics.latencyMs ?? metrics.jinaLatencyMs;
  return (
    <Card className="min-w-0">
      <CardHeader className="gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="capitalize">{run.variant}</CardTitle>
          <Badge variant={run.status === "failed" ? "destructive" : "outline"}>
            {run.status}
          </Badge>
          {typeof score === "number" ? (
            <Badge variant={metrics.passed ? "secondary" : "outline"}>
              {Math.round(score * 100)}%
            </Badge>
          ) : null}
        </div>
        <CardDescription>
          {[run.provider, run.model, formatLatency(latency)]
            .filter(Boolean)
            .join(" · ")}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {run.error ? (
          <p className="whitespace-pre-wrap rounded-md bg-destructive/10 p-3 text-destructive text-xs">
            {run.error}
          </p>
        ) : null}
        {run.intermediate ? (
          <JsonPanel label="Jina intermediate" value={run.intermediate} />
        ) : null}
        {run.output ? <JsonPanel label="Output" value={run.output} /> : null}
        {(metrics.checks ?? []).length > 0 ? (
          <div className="grid gap-1.5">
            <div className="font-medium text-xs">Ground-truth checks</div>
            {metrics.checks?.map((check) => (
              <div
                className="flex items-start gap-2 text-muted-foreground text-xs"
                key={check.label}
              >
                {check.passed ? (
                  <Check className="mt-0.5 size-3.5 shrink-0 text-emerald-600" />
                ) : (
                  <X className="mt-0.5 size-3.5 shrink-0 text-destructive" />
                )}
                <span>{check.label}</span>
              </div>
            ))}
          </div>
        ) : null}
        {run.status === "queued" || run.status === "running" ? (
          <p className="text-muted-foreground text-xs">
            The paired Codex companion will update this run automatically.
          </p>
        ) : null}
      </CardContent>
      <CardFooter className="justify-between">
        <span className="text-muted-foreground text-xs">
          {new Date(run.createdAt).toLocaleString()}
        </span>
        {onReplay ? (
          <Button onClick={onReplay} size="sm" variant="outline">
            <RotateCcw /> Replay
          </Button>
        ) : null}
      </CardFooter>
    </Card>
  );
}

export function JsonPanel({ label, value }: { label: string; value: unknown }) {
  const text = JSON.stringify(value, null, 2);
  async function copy() {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  }
  return (
    <div className="min-w-0 rounded-md border bg-muted/30">
      <div className="flex items-center justify-between border-b px-3 py-1.5">
        <span className="font-medium text-xs">{label}</span>
        <Button onClick={() => void copy()} size="icon-xs" variant="ghost">
          <Copy />
          <span className="sr-only">Copy {label}</span>
        </Button>
      </div>
      <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-xs leading-5">
        {text}
      </pre>
    </div>
  );
}

function formatLatency(value: unknown) {
  return typeof value === "number" ? `${(value / 1000).toFixed(1)}s` : "";
}
