import { RefreshCw, TimerReset } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ApiRequest } from "@/lib/api";
import type { InventoryRefreshSummary, InventorySourceSummary } from "./status";

type ScheduleUnit = "days" | "hours" | "minutes";
type BusyAction = "disable-schedule" | "full" | "latest" | "schedule" | null;

interface InventoryRefreshControlsProps {
  activeRefresh: InventoryRefreshSummary | undefined;
  onChanged: () => Promise<unknown>;
  request: ApiRequest;
  source: InventorySourceSummary;
}

const scheduleUnits = [
  { label: "Minutes", value: "minutes" },
  { label: "Hours", value: "hours" },
  { label: "Days", value: "days" },
];
const scheduleUnitMinutes: Record<ScheduleUnit, number> = {
  days: 24 * 60,
  hours: 60,
  minutes: 1,
};

export function InventoryRefreshControls({
  activeRefresh,
  onChanged,
  request,
  source,
}: InventoryRefreshControlsProps) {
  const [busy, setBusy] = useState<BusyAction>(null);
  const [scheduleAmount, setScheduleAmount] = useState("");
  const [scheduleUnit, setScheduleUnit] = useState<ScheduleUnit>("hours");

  useEffect(() => {
    const schedule = displaySchedule(source.refreshIntervalMinutes);
    setScheduleAmount(schedule.amount);
    setScheduleUnit(schedule.unit);
  }, [source.refreshIntervalMinutes]);

  async function queue(mode: "full" | "latest") {
    setBusy(mode);
    try {
      await request("/api/inventory/refreshes", {
        body: JSON.stringify({ boards: [], mode, sourceId: source.id }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      await onChanged();
      toast.success(
        mode === "full"
          ? "Full inventory reconciliation queued"
          : "Latest inventory refresh queued"
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Inventory refresh failed"
      );
    } finally {
      setBusy(null);
    }
  }

  async function saveSchedule(refreshIntervalMinutes: number | null) {
    setBusy(refreshIntervalMinutes === null ? "disable-schedule" : "schedule");
    try {
      await request(`/api/inventory/sources/${source.id}/schedule`, {
        body: JSON.stringify({ refreshIntervalMinutes }),
        headers: { "content-type": "application/json" },
        method: "PUT",
      });
      await onChanged();
      toast.success(
        refreshIntervalMinutes === null
          ? "Inventory schedule turned off"
          : "Inventory schedule saved"
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Schedule update failed"
      );
    } finally {
      setBusy(null);
    }
  }

  function scheduleMinutes() {
    const amount = Number(scheduleAmount);
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      toast.error("Enter a positive whole-number refresh interval");
      return;
    }
    const minutes = amount * scheduleUnitMinutes[scheduleUnit];
    if (!Number.isSafeInteger(minutes)) {
      toast.error("Refresh interval is too large");
      return;
    }
    void saveSchedule(minutes);
  }

  const unavailable = Boolean(busy) || Boolean(activeRefresh);
  return (
    <div className="grid gap-4 rounded-lg border p-3">
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={unavailable}
          onClick={() => void queue("latest")}
          variant="secondary"
        >
          <RefreshCw className={busy === "latest" ? "animate-spin" : ""} />
          {busy === "latest" ? "Queueing…" : "Refresh latest"}
        </Button>
        <AlertDialog>
          <AlertDialogTrigger
            disabled={unavailable}
            render={<Button variant="outline" />}
          >
            Full reconciliation
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Reconcile every source listing?
              </AlertDialogTitle>
              <AlertDialogDescription>
                The paired runner will crawl every configured board. Listings
                absent from the completed source snapshot will be closed while
                each user&apos;s saved state remains intact.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => void queue("full")}>
                Queue full reconciliation
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      <div className="grid items-end gap-2 sm:grid-cols-[minmax(7rem,1fr)_minmax(7rem,1fr)_auto]">
        <Field>
          <FieldLabel htmlFor="inventory-schedule-amount">
            Refresh every
          </FieldLabel>
          <Input
            id="inventory-schedule-amount"
            min={1}
            onChange={(event) => setScheduleAmount(event.target.value)}
            placeholder="Not scheduled"
            step={1}
            type="number"
            value={scheduleAmount}
          />
        </Field>
        <Field>
          <FieldLabel>Interval unit</FieldLabel>
          <Select
            items={scheduleUnits}
            onValueChange={(value) => setScheduleUnit(value as ScheduleUnit)}
            value={scheduleUnit}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {scheduleUnits.map((unit) => (
                  <SelectItem key={unit.value} value={unit.value}>
                    {unit.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
        <Button
          disabled={Boolean(busy) || !scheduleAmount}
          onClick={scheduleMinutes}
          variant="outline"
        >
          <TimerReset /> {busy === "schedule" ? "Saving…" : "Save schedule"}
        </Button>
      </div>
      {source.refreshIntervalMinutes === null ? null : (
        <div className="flex flex-wrap items-center justify-between gap-2 text-muted-foreground text-xs">
          <span>
            Next refresh:{" "}
            {formatDate(source.nextRefreshAt) ?? "awaiting schedule"}
          </span>
          <Button
            disabled={Boolean(busy)}
            onClick={() => void saveSchedule(null)}
            size="sm"
            variant="ghost"
          >
            {busy === "disable-schedule" ? "Turning off…" : "Turn off schedule"}
          </Button>
        </div>
      )}
    </div>
  );
}

function displaySchedule(minutes: number | null) {
  if (minutes === null) {
    return { amount: "", unit: "hours" as const };
  }
  if (minutes % (24 * 60) === 0) {
    return { amount: String(minutes / (24 * 60)), unit: "days" as const };
  }
  if (minutes % 60 === 0) {
    return { amount: String(minutes / 60), unit: "hours" as const };
  }
  return { amount: String(minutes), unit: "minutes" as const };
}

function formatDate(value: string | null) {
  if (!value) {
    return null;
  }
  return new Date(value).toLocaleString();
}
