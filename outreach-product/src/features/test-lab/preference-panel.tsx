import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { JsonPanel } from "@/features/test-lab/run-result";
import type { TestLabRun } from "@/features/test-lab/types";
import type { ApiRequest } from "@/lib/api";

type Preference = "both_bad" | "left" | "right" | "tie";

export function PreferencePanel({
  onRefresh,
  request,
  runs,
}: {
  onRefresh: () => Promise<unknown>;
  request: ApiRequest;
  runs: TestLabRun[];
}) {
  const completed = runs.filter((runItem) => runItem.status === "completed");
  const [leftRunId, setLeftRunId] = useState("");
  const [rightRunId, setRightRunId] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const left = completed.find((runItem) => runItem.id === leftRunId);
  const right = completed.find((runItem) => runItem.id === rightRunId);

  useEffect(() => {
    const [first, second] = completed;
    if (!leftRunId && first) {
      setLeftRunId(first.id);
    }
    if (!rightRunId && second) {
      setRightRunId(second.id);
    }
  }, [completed, leftRunId, rightRunId]);

  if (completed.length < 2) {
    return null;
  }

  async function save(preference: Preference) {
    if (!(left && right) || left.id === right.id) {
      toast.error("Choose two different completed runs");
      return;
    }
    setBusy(true);
    try {
      const response = await request("/api/test-lab/preferences", {
        body: JSON.stringify({
          leftRunId: left.id,
          notes,
          preference,
          rightRunId: right.id,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const result = (await response.json()) as { message: string };
      await onRefresh();
      toast.success(result.message);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Preference could not be saved"
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Human preference</CardTitle>
        <CardDescription>
          Compare two completed outputs from this exact case and record the
          result as evaluation data.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-3 lg:grid-cols-2">
          <RunSelector
            label="Left run"
            onChange={setLeftRunId}
            runs={completed}
            value={leftRunId}
          />
          <RunSelector
            label="Right run"
            onChange={setRightRunId}
            runs={completed}
            value={rightRunId}
          />
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          <JsonPanel
            label={`Left · ${left?.variant ?? "choose a run"}`}
            value={left?.output ?? null}
          />
          <JsonPanel
            label={`Right · ${right?.variant ?? "choose a run"}`}
            value={right?.output ?? null}
          />
        </div>
        <label
          className="grid gap-1.5 text-sm"
          htmlFor="test-lab-preference-notes"
        >
          <span className="font-medium">Optional notes</span>
          <Textarea
            id="test-lab-preference-notes"
            onChange={(event) => setNotes(event.target.value)}
            placeholder="What made one result better?"
            value={notes}
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy} onClick={() => void save("left")}>
            Left is better
          </Button>
          <Button
            disabled={busy}
            onClick={() => void save("right")}
            variant="outline"
          >
            Right is better
          </Button>
          <Button
            disabled={busy}
            onClick={() => void save("tie")}
            variant="outline"
          >
            Tie
          </Button>
          <Button
            disabled={busy}
            onClick={() => void save("both_bad")}
            variant="outline"
          >
            Both need work
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function RunSelector({
  label,
  onChange,
  runs,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  runs: TestLabRun[];
  value: string;
}) {
  return (
    <div className="grid gap-1.5 text-sm">
      <span className="font-medium">{label}</span>
      <Select
        items={runs.map((runItem) => ({
          label: runLabel(runItem),
          value: runItem.id,
        }))}
        onValueChange={(next) => next && onChange(next)}
        value={value}
      >
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Choose a completed run" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {runs.map((runItem) => (
              <SelectItem key={runItem.id} value={runItem.id}>
                {runLabel(runItem)}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  );
}

function runLabel(run: TestLabRun) {
  return `${run.variant} · ${new Date(run.createdAt).toLocaleString()}`;
}
