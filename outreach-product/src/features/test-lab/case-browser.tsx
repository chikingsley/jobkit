import { ArrowLeft, FlaskConical, Play } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PreferencePanel } from "@/features/test-lab/preference-panel";
import { TestLabRunResult } from "@/features/test-lab/run-result";
import {
  type TestLabResponse,
  type TestLabRun,
  testLabCapabilities,
  variantLabels,
} from "@/features/test-lab/types";
import { SplitWorkspace } from "@/features/workspace/split-workspace";
import type { ApiRequest } from "@/lib/api";
import type { TestLabCapability, TestLabVariant } from "@/test-lab/corpus";

export function TestLabCaseBrowser({
  data,
  onRefresh,
  request,
  selectedCaseId,
  setSelectedCaseId,
}: {
  data: TestLabResponse;
  onRefresh: () => Promise<unknown>;
  request: ApiRequest;
  selectedCaseId: string;
  setSelectedCaseId: (caseId: string) => void;
}) {
  const [capability, setCapability] = useState<"all" | TestLabCapability>(
    "all"
  );
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<TestLabVariant | "">("");
  const selectedCase = data.cases.find(
    (testCase) => testCase.id === selectedCaseId
  );
  const filteredCases = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("en");
    return data.cases.filter(
      (testCase) =>
        (capability === "all" || testCase.capability === capability) &&
        (!normalizedQuery ||
          `${testCase.name} ${testCase.description} ${testCase.id}`
            .toLocaleLowerCase("en")
            .includes(normalizedQuery))
    );
  }, [capability, data.cases, query]);
  const caseRuns = data.runs.filter((run) => run.caseId === selectedCaseId);

  async function start(variant: TestLabVariant) {
    if (!selectedCase) {
      return;
    }
    setBusy(variant);
    try {
      const response = await request("/api/test-lab/runs", {
        body: JSON.stringify({ caseId: selectedCase.id, variant }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const result = (await response.json()) as { message: string };
      await onRefresh();
      toast.success(result.message);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Test run failed");
    } finally {
      setBusy("");
    }
  }

  async function replay(run: TestLabRun) {
    try {
      const response = await request(`/api/test-lab/runs/${run.id}/replay`, {
        method: "POST",
      });
      const result = (await response.json()) as { message: string };
      await onRefresh();
      toast.success(result.message);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Test replay failed"
      );
    }
  }

  return (
    <SplitWorkspace
      detail={
        selectedCase ? (
          <ScrollArea className="min-h-0 flex-1">
            <div className="mx-auto grid w-full max-w-5xl gap-4 p-4 sm:p-6">
              <Button
                className="split-workspace-back justify-self-start"
                onClick={() => setSelectedCaseId("")}
                size="sm"
                variant="ghost"
              >
                <ArrowLeft /> Cases
              </Button>
              <Card>
                <CardHeader>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="secondary">{selectedCase.capability}</Badge>
                    <Badge variant="outline">{selectedCase.id}</Badge>
                  </div>
                  <CardTitle>{selectedCase.name}</CardTitle>
                  <CardDescription>{selectedCase.description}</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4">
                  <div className="grid gap-3 lg:grid-cols-2">
                    <CompactJson label="Input" value={selectedCase.input} />
                    <CompactJson
                      label="Ground truth"
                      value={selectedCase.expected}
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {selectedCase.supportedVariants.map((variant) => (
                      <Button
                        disabled={
                          Boolean(busy) ||
                          (variant === "jina" && !data.integrations.jina) ||
                          (variant === "hybrid" && !data.integrations.jina)
                        }
                        key={variant}
                        onClick={() => void start(variant)}
                        variant={variant === "codex" ? "default" : "outline"}
                      >
                        <Play />
                        {busy === variant
                          ? "Running…"
                          : `Run ${variantLabels[variant]}`}
                      </Button>
                    ))}
                  </div>
                </CardContent>
              </Card>
              <div className="grid gap-4 xl:grid-cols-2">
                {caseRuns.map((run) => (
                  <TestLabRunResult
                    key={run.id}
                    onReplay={() => void replay(run)}
                    run={run}
                  />
                ))}
              </div>
              <PreferencePanel
                key={selectedCase.id}
                onRefresh={onRefresh}
                request={request}
                runs={caseRuns}
                testCase={selectedCase}
              />
              {caseRuns.length === 0 ? (
                <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground text-sm">
                  Run a variant to record its output, score, latency, and
                  provenance.
                </div>
              ) : null}
            </div>
          </ScrollArea>
        ) : (
          <div className="grid flex-1 place-items-center p-8 text-center text-muted-foreground text-sm">
            Select one of the versioned cases to inspect its inputs and ground
            truth.
          </div>
        )
      }
      detailClassName="h-[calc(100svh-15.5rem)] min-h-[34rem]"
      detailOpen={Boolean(selectedCase)}
      list={
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="grid gap-2 border-b p-3">
            <Input
              aria-label="Search Test Lab cases"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search 100 cases"
              value={query}
            />
            <Select
              items={testLabCapabilities}
              onValueChange={(value) => {
                if (value) {
                  setCapability(value as "all" | TestLabCapability);
                }
              }}
              value={capability}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {testLabCapabilities.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          <ScrollArea className="min-h-0 flex-1">
            <div className="grid gap-1 p-2">
              {filteredCases.map((testCase) => {
                const latest = data.runs.find(
                  (run) => run.caseId === testCase.id
                );
                return (
                  <button
                    className="grid w-full gap-1 rounded-md px-3 py-2.5 text-left hover:bg-muted data-[active=true]:bg-muted"
                    data-active={selectedCaseId === testCase.id}
                    key={testCase.id}
                    onClick={() => setSelectedCaseId(testCase.id)}
                    type="button"
                  >
                    <span className="flex items-center gap-2">
                      <FlaskConical className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate font-medium text-sm">
                        {testCase.name}
                      </span>
                    </span>
                    <span className="flex items-center justify-between gap-2 pl-5 text-muted-foreground text-xs">
                      <span>{testCase.capability}</span>
                      {latest ? <span>{latest.status}</span> : null}
                    </span>
                  </button>
                );
              })}
            </div>
          </ScrollArea>
        </div>
      }
      listClassName="h-[calc(100svh-15.5rem)] min-h-[34rem]"
    />
  );
}

function CompactJson({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="min-w-0 rounded-md border bg-muted/20 p-3">
      <div className="mb-2 font-medium text-xs">{label}</div>
      <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-5">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}
