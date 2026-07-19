import { CheckCircle2, Copy, Database, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import useSWR from "swr";
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
import type { ApiRequest } from "@/lib/api";

interface InventoryRunSummary {
  closedCount: number;
  completedAt: string | null;
  error: string;
  failedCount: number;
  id: string;
  processedCount: number;
  sourceActiveCount: number;
  sourceId: string;
  sourceTotalCount: number;
  startedAt: string;
  status: string;
  unchangedCount: number;
  upsertedCount: number;
}

interface InventorySourceSummary {
  id: string;
  lastError: string;
  lastSuccessAt: string | null;
  name: string;
  status: string;
}

interface InventoryStatus {
  runs: InventoryRunSummary[];
  sources: InventorySourceSummary[];
}

const SYNC_COMMAND = "bun run jobkit -- inventory sync --apply";

export function InventoryStatusCard({ request }: { request: ApiRequest }) {
  const { data, isLoading } = useSWR(
    "/api/inventory/status",
    async (path) => (await (await request(path)).json()) as InventoryStatus
  );
  const source = data?.sources.find(
    (candidate) => candidate.id === "job-search-sqlite"
  );
  const run = data?.runs.find(
    (candidate) => candidate.sourceId === "job-search-sqlite"
  );

  async function copyCommand() {
    await navigator.clipboard.writeText(SYNC_COMMAND);
    toast.success("Inventory command copied");
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Database className="size-4" /> Inventory
            </CardTitle>
            <CardDescription>
              The paired operations runner reconciles the complete local source
              snapshot with the hosted job catalog.
            </CardDescription>
          </div>
          <InventoryBadge loading={isLoading} run={run} />
        </div>
      </CardHeader>
      <CardContent className="grid gap-3">
        {run ? (
          <div className="grid gap-3 rounded-lg border p-3 sm:grid-cols-3">
            <Metric label="Source records" value={run.sourceTotalCount} />
            <Metric label="Active listings" value={run.sourceActiveCount} />
            <Metric label="Closed this run" value={run.closedCount} />
          </div>
        ) : (
          <div className="rounded-lg border p-3 text-muted-foreground text-sm">
            No hosted inventory run has completed yet.
          </div>
        )}
        {source?.lastSuccessAt ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <CheckCircle2 className="size-4 text-emerald-600" /> Last reconciled{" "}
            {new Date(source.lastSuccessAt).toLocaleString()}
          </div>
        ) : null}
        {source?.lastError || run?.error ? (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
            <TriangleAlert className="mt-0.5 size-4 text-destructive" />
            <span>{source?.lastError || run?.error}</span>
          </div>
        ) : null}
        <code className="break-all rounded bg-muted p-2 text-xs">
          {SYNC_COMMAND}
        </code>
      </CardContent>
      <CardFooter className="justify-between gap-3">
        <span className="text-muted-foreground text-xs">
          Dry-run is the default; --apply is explicit.
        </span>
        <Button onClick={() => void copyCommand()} variant="outline">
          <Copy /> Copy command
        </Button>
      </CardFooter>
    </Card>
  );
}

function InventoryBadge({
  loading,
  run,
}: {
  loading: boolean;
  run: InventoryRunSummary | undefined;
}) {
  if (loading) {
    return <Badge variant="outline">Loading</Badge>;
  }
  if (!run) {
    return <Badge variant="outline">Not run</Badge>;
  }
  return (
    <Badge variant={run.status === "completed" ? "secondary" : "outline"}>
      {run.status}
    </Badge>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="font-semibold text-lg tabular-nums">
        {value.toLocaleString()}
      </div>
      <div className="text-muted-foreground text-xs">{label}</div>
    </div>
  );
}
