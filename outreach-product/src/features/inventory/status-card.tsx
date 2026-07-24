import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Database, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ACTIVE_INVENTORY_REFRESH_STATUSES,
  inventoryKeys,
  useInventoryStatus,
} from "@/features/inventory/queries";
import type { ApiRequest } from "@/lib/api";
import { InventoryRefreshControls } from "./refresh-controls";
import type { InventoryRefreshSummary, InventoryRunSummary } from "./status";

const SOURCE_ID = "job-search-sqlite";

export function InventoryStatusCard({ request }: { request: ApiRequest }) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useInventoryStatus();
  const source = data?.sources.find((candidate) => candidate.id === SOURCE_ID);
  const run = data?.runs.find((candidate) => candidate.sourceId === SOURCE_ID);
  const activeRefresh = data?.refreshes.find(
    (candidate) =>
      candidate.sourceId === SOURCE_ID &&
      ACTIVE_INVENTORY_REFRESH_STATUSES.has(candidate.status)
  );
  const latestRefresh = data?.refreshes.find(
    (candidate) => candidate.sourceId === SOURCE_ID
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Database className="size-4" /> Inventory
            </CardTitle>
            <CardDescription>
              The paired operations runner refreshes source boards and
              reconciles their durable snapshot with the hosted job catalog.
            </CardDescription>
          </div>
          <InventoryBadge
            loading={isLoading}
            refresh={activeRefresh}
            run={run}
          />
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        {run ? (
          <div className="grid gap-3 rounded-lg border p-3 sm:grid-cols-3">
            <Metric label="Source records" value={run.sourceTotalCount} />
            <Metric label="Active listings" value={run.sourceActiveCount} />
            <Metric label="Closed this run" value={run.closedCount} />
          </div>
        ) : (
          <div className="rounded-lg border p-3 text-muted-foreground text-sm">
            No hosted inventory snapshot has completed yet.
          </div>
        )}
        {activeRefresh ? <RefreshProgress refresh={activeRefresh} /> : null}
        {!activeRefresh && latestRefresh ? (
          <div className="text-muted-foreground text-sm">
            Last refresh request: {latestRefresh.mode} · {latestRefresh.status}{" "}
            · {new Date(latestRefresh.updatedAt).toLocaleString()}
          </div>
        ) : null}
        {source?.lastSuccessAt ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <CheckCircle2 className="size-4 text-emerald-600" /> Last reconciled{" "}
            {new Date(source.lastSuccessAt).toLocaleString()}
          </div>
        ) : null}
        {source?.lastError || run?.error || latestRefresh?.error ? (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
            <TriangleAlert className="mt-0.5 size-4 text-destructive" />
            <span>
              {source?.lastError || run?.error || latestRefresh?.error}
            </span>
          </div>
        ) : null}
        {source?.canOperate ? (
          <InventoryRefreshControls
            activeRefresh={activeRefresh}
            onChanged={() =>
              queryClient.invalidateQueries({ queryKey: inventoryKeys.status })
            }
            request={request}
            source={source}
          />
        ) : (
          <p className="text-muted-foreground text-sm">
            Inventory controls are available to an assigned source operator.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function InventoryBadge({
  loading,
  refresh,
  run,
}: {
  loading: boolean;
  refresh: InventoryRefreshSummary | undefined;
  run: InventoryRunSummary | undefined;
}) {
  if (loading) {
    return <Badge variant="outline">Loading</Badge>;
  }
  if (refresh) {
    return <Badge variant="secondary">{refresh.status}</Badge>;
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

function RefreshProgress({ refresh }: { refresh: InventoryRefreshSummary }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/30 p-3 text-sm">
      <span>
        {refresh.mode === "full" ? "Full reconciliation" : "Latest refresh"} ·{" "}
        {refresh.boards.length > 0 ? refresh.boards.join(", ") : "all boards"}
      </span>
      <Badge variant="outline">{refresh.status}</Badge>
    </div>
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
