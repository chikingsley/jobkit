import { useNavigate, useSearch } from "@tanstack/react-router";
import { RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import useSWR from "swr";
import { SettingsPage } from "@/components/settings-page";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TestLabCaseBrowser } from "@/features/test-lab/case-browser";
import { ClassificationReview } from "@/features/test-lab/classification-review";
import { DeliveryLab } from "@/features/test-lab/delivery-lab";
import { DocumentLab } from "@/features/test-lab/document-lab";
import { TestLabRunResult } from "@/features/test-lab/run-result";
import type { TestLabResponse, TestLabRun } from "@/features/test-lab/types";
import type { ApiRequest } from "@/lib/api";

const ACTIVE_REFRESH_MS = 2000;

export function TestLabView({ request }: { request: ApiRequest }) {
  const navigate = useNavigate({ from: "/app/operator/test-lab" });
  const search = useSearch({ from: "/app/operator/test-lab" });
  const selectedCaseId = search.case ?? "";
  const selectedClassificationId = search.classification ?? "";
  const activeTab = search.tab ?? "cases";
  const { data, isLoading, mutate } = useSWR(
    "/api/test-lab",
    async (path) => (await (await request(path)).json()) as TestLabResponse,
    {
      refreshInterval: (current) =>
        current?.summary.active ? ACTIVE_REFRESH_MS : 0,
    }
  );

  async function replay(run: TestLabRun) {
    try {
      const response = await request(`/api/test-lab/runs/${run.id}/replay`, {
        method: "POST",
      });
      const result = (await response.json()) as { message: string };
      await mutate();
      toast.success(result.message);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Test replay failed"
      );
    }
  }

  async function reset() {
    try {
      await request("/api/test-lab", { method: "DELETE" });
      await mutate();
      toast.success("Test Lab history reset");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Reset failed");
    }
  }

  if (isLoading || !data) {
    return (
      <SettingsPage
        description="Recorded evaluations for Codex, Jina, and hybrid variants."
        title="Test Lab"
      >
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground text-sm">
            Loading the versioned evaluation corpus…
          </CardContent>
        </Card>
      </SettingsPage>
    );
  }

  return (
    <SettingsPage
      description="Replay 100 labeled cases, inspect provider evidence, compare Codex with Jina one capability at a time, and keep test delivery isolated from real outreach."
      title="Test Lab"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{data.cases.length} cases</Badge>
        <Badge variant="outline">{data.corpusVersion}</Badge>
        <Badge variant={data.integrations.jina ? "secondary" : "outline"}>
          Jina {data.integrations.jina ? "configured" : "not configured"}
        </Badge>
        <Badge variant="outline">
          {data.summary.completed} completed · {data.summary.active} active ·{" "}
          {data.summary.failed} failed
        </Badge>
        <div className="ml-auto flex gap-2">
          <Button onClick={() => void mutate()} size="sm" variant="outline">
            <RotateCcw /> Refresh
          </Button>
          <ResetButton onReset={() => void reset()} />
        </div>
      </div>

      <Tabs
        onValueChange={(value) => {
          void navigate({
            search: (current) => ({ ...current, tab: value }),
          });
        }}
        value={activeTab}
      >
        <TabsList variant="line">
          <TabsTrigger value="cases">Cases</TabsTrigger>
          <TabsTrigger value="classification">
            Classification review
          </TabsTrigger>
          <TabsTrigger value="runs">Run history</TabsTrigger>
          <TabsTrigger value="documents">Document OCR</TabsTrigger>
          <TabsTrigger value="delivery">Delivery sink</TabsTrigger>
        </TabsList>
        <TabsContent value="cases">
          <TestLabCaseBrowser
            data={data}
            onRefresh={() => mutate()}
            request={request}
            selectedCaseId={selectedCaseId}
            setSelectedCaseId={(caseId) => {
              void navigate({
                search: (current) => ({
                  ...current,
                  case: caseId || undefined,
                }),
              });
            }}
          />
        </TabsContent>
        <TabsContent value="classification">
          <ClassificationReview
            request={request}
            selectedCaseId={selectedClassificationId}
            setSelectedCaseId={(itemId) => {
              void navigate({
                search: (current) => ({
                  ...current,
                  classification: itemId || undefined,
                  tab: "classification",
                }),
              });
            }}
          />
        </TabsContent>
        <TabsContent value="runs">
          <div className="grid gap-4 xl:grid-cols-2">
            {data.runs.map((run) => (
              <TestLabRunResult
                key={run.id}
                onReplay={() => void replay(run)}
                run={run}
              />
            ))}
          </div>
          {data.runs.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground text-sm">
                No recorded runs yet.
              </CardContent>
            </Card>
          ) : null}
        </TabsContent>
        <TabsContent value="documents">
          <DocumentLab
            data={data}
            onRefresh={() => mutate()}
            request={request}
          />
        </TabsContent>
        <TabsContent value="delivery">
          <DeliveryLab request={request} />
        </TabsContent>
      </Tabs>
    </SettingsPage>
  );
}

function ResetButton({ onReset }: { onReset: () => void }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger render={<Button size="sm" variant="outline" />}>
        <Trash2 /> Reset
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Reset Test Lab history?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes recorded runs and preferences for this account. The
            versioned corpus remains unchanged. Active runs must finish or be
            cancelled first.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep history</AlertDialogCancel>
          <AlertDialogAction onClick={onReset}>Reset history</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
