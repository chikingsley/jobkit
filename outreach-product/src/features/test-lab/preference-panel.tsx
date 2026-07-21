import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { JsonPanel } from "@/features/test-lab/run-result";
import type { TestLabRun } from "@/features/test-lab/types";
import type { ApiRequest } from "@/lib/api";
import type { TestLabCase } from "@/test-lab/corpus";

type Preference = "both_bad" | "left" | "right" | "tie";

const REVIEWABLE_CAPABILITIES = new Set([
  "deepsearch",
  "reader",
  "reranking",
  "revision",
  "search",
]);

export function PreferencePanel({
  onRefresh,
  request,
  runs,
  testCase,
}: {
  onRefresh: () => Promise<unknown>;
  request: ApiRequest;
  runs: TestLabRun[];
  testCase: TestLabCase;
}) {
  const comparison = useMemo(() => blindComparison(runs), [runs]);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [revealedPair, setRevealedPair] = useState("");

  if (!comparison) {
    return null;
  }

  const { left, right } = comparison;
  const pairId = `${left.id}:${right.id}`;

  async function save(preference: Preference) {
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
      setRevealedPair(pairId);
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
        <CardTitle>Blind output comparison</CardTitle>
        <CardDescription>
          {comparisonQuestion(left.capability)} Provider identities stay hidden
          until you record the result.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-3 lg:grid-cols-2">
          <BlindOutput label="Option A" run={left} testCase={testCase} />
          <BlindOutput label="Option B" run={right} testCase={testCase} />
        </div>
        <label
          className="grid gap-1.5 text-sm"
          htmlFor="test-lab-preference-notes"
        >
          <span className="font-medium">Optional notes</span>
          <Textarea
            id="test-lab-preference-notes"
            onChange={(event) => setNotes(event.target.value)}
            placeholder="What made one result more useful or trustworthy?"
            value={notes}
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy} onClick={() => void save("left")}>
            Option A is better
          </Button>
          <Button
            disabled={busy}
            onClick={() => void save("right")}
            variant="outline"
          >
            Option B is better
          </Button>
          <Button
            disabled={busy}
            onClick={() => void save("tie")}
            variant="outline"
          >
            Equally useful
          </Button>
          <Button
            disabled={busy}
            onClick={() => void save("both_bad")}
            variant="outline"
          >
            Neither is useful
          </Button>
        </div>
        {revealedPair === pairId ? (
          <p className="text-muted-foreground text-sm">
            Option A was {providerLabel(left)}. Option B was{" "}
            {providerLabel(right)}.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function blindComparison(runs: TestLabRun[]) {
  const completed = runs.filter(
    (run) =>
      run.status === "completed" && REVIEWABLE_CAPABILITIES.has(run.capability)
  );
  const latestByVariant = new Map<string, TestLabRun>();
  for (const run of completed) {
    const current = latestByVariant.get(run.variant);
    if (!current || run.createdAt > current.createdAt) {
      latestByVariant.set(run.variant, run);
    }
  }
  const pair = preferredPair(latestByVariant);
  if (!pair) {
    return null;
  }
  const [first, second] = pair;
  const swap = stableParity(`${first.caseId}:${first.id}:${second.id}`) === 1;
  return swap ? { left: second, right: first } : { left: first, right: second };
}

function preferredPair(runs: Map<string, TestLabRun>) {
  for (const [leftVariant, rightVariant] of [
    ["codex", "jina"],
    ["jina", "hybrid"],
    ["codex", "hybrid"],
  ] as const) {
    const left = runs.get(leftVariant);
    const right = runs.get(rightVariant);
    if (left && right) {
      return [left, right] as const;
    }
  }
  return null;
}

function comparisonQuestion(capability: string) {
  switch (capability) {
    case "reader":
      return "Which extraction captures the supplied page more completely and faithfully?";
    case "search":
      return "Which result set contains more relevant, primary, directly useful sources?";
    case "reranking":
      return "Which ordering puts the most relevant opportunities first without promoting an ineligible role?";
    case "deepsearch":
      return "Which answer is better supported by direct sources and answers the exact question?";
    case "revision":
      return "Which revision follows the requested change while preserving the original voice and facts?";
    default:
      return "Which output is more useful for the stated task?";
  }
}

function BlindOutput({
  label,
  run,
  testCase,
}: {
  label: string;
  run: TestLabRun;
  testCase: TestLabCase;
}) {
  if (run.capability !== "reranking") {
    return <JsonPanel label={label} value={run.output} />;
  }
  const documents = documentMap(testCase.input.documents);
  const orderedIds = stringArray(objectValue(run.output, "orderedIds"));
  return (
    <div className="min-w-0 rounded-md border bg-muted/30">
      <div className="border-b px-3 py-1.5 font-medium text-xs">{label}</div>
      <ol className="grid gap-2 p-3">
        {orderedIds.map((id, index) => (
          <li className="rounded-md border bg-background p-3 text-sm" key={id}>
            <span className="mr-2 font-medium text-muted-foreground">
              {index + 1}.
            </span>
            {documents.get(id) ?? id}
          </li>
        ))}
      </ol>
    </div>
  );
}

function documentMap(value: unknown) {
  const documents = new Map<string, string>();
  if (!Array.isArray(value)) {
    return documents;
  }
  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const record = item as Record<string, unknown>;
    if (typeof record.id === "string" && typeof record.text === "string") {
      documents.set(record.id, record.text);
    }
  }
  return documents;
}

function objectValue(value: unknown, key: string) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function providerLabel(run: TestLabRun) {
  return [run.provider, run.model].filter(Boolean).join(" · ");
}

function stableParity(value: string) {
  return (
    [...value].reduce(
      (total, character) => total + character.charCodeAt(0),
      0
    ) % 2
  );
}
