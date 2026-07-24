import { LoaderCircle, RefreshCcw, X } from "lucide-react";
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
import {
  type AgentTaskRequestSummary,
  type AutonomousTaskSummary,
  isActiveAgentTask,
  useAgentTaskHistory,
  useAgentTaskMutation,
} from "@/features/agents/queries";

export function AgentTaskHistory() {
  const { data } = useAgentTaskHistory();
  const taskMutation = useAgentTaskMutation();

  async function mutateTask(
    task: AgentTaskRequestSummary,
    action: "cancel" | "retry"
  ) {
    try {
      await taskMutation.mutateAsync({ action, taskId: task.id });
      toast.success(
        action === "retry" ? "Codex task queued again" : "Codex task cancelled"
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Task update failed"
      );
    }
  }

  const requests = data?.requests ?? [];
  const autonomousRuns = data?.autonomousRuns ?? [];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Codex task history</CardTitle>
        <CardDescription>
          Current work, immutable run provenance, failures, retries, and queued
          cancellations from paired Codex agents.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {requests.map((task) => (
          <TaskRequestRow
            key={task.id}
            onCancel={() => void mutateTask(task, "cancel")}
            onRetry={() => void mutateTask(task, "retry")}
            task={task}
          />
        ))}
        {autonomousRuns.map((run) => (
          <AutonomousRunRow key={run.id} run={run} />
        ))}
        {requests.length === 0 && autonomousRuns.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No Codex tasks have run for this account.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function TaskRequestRow({
  onCancel,
  onRetry,
  task,
}: {
  onCancel: () => void;
  onRetry: () => void;
  task: AgentTaskRequestSummary;
}) {
  return (
    <div className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          {isActiveAgentTask(task) ? (
            <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
          ) : null}
          <span className="font-medium text-sm">
            {taskLabel(task.taskType)}
          </span>
          <Badge variant={task.status === "failed" ? "destructive" : "outline"}>
            {task.status}
          </Badge>
        </div>
        <p className="mt-1 truncate text-muted-foreground text-xs">
          {task.subjectType}: {task.subjectId}
        </p>
        {task.run ? (
          <p className="mt-1 text-muted-foreground text-xs">
            {task.run.model} · {task.run.promptVersion} · {task.run.runnerName}
          </p>
        ) : null}
        {task.error ? (
          <p className="mt-2 whitespace-pre-wrap text-destructive text-xs">
            {task.error}
          </p>
        ) : null}
      </div>
      <div className="flex gap-2">
        {task.status === "queued" ? (
          <Button onClick={onCancel} size="sm" variant="outline">
            <X /> Cancel
          </Button>
        ) : null}
        {task.status === "failed" || task.status === "cancelled" ? (
          <Button onClick={onRetry} size="sm" variant="outline">
            <RefreshCcw /> Retry
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function AutonomousRunRow({ run }: { run: AutonomousTaskSummary }) {
  return (
    <div className="rounded-lg border border-dashed p-3">
      <div className="flex flex-wrap items-center gap-2">
        {run.status === "running" ? (
          <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
        ) : null}
        <span className="font-medium text-sm">{taskLabel(run.taskType)}</span>
        <Badge variant="outline">{run.status}</Badge>
        <Badge variant="secondary">automatic inventory</Badge>
      </div>
      <p className="mt-1 text-muted-foreground text-xs">
        {run.model} · {run.promptVersion} · {run.runnerName}
      </p>
      {run.error ? (
        <p className="mt-2 whitespace-pre-wrap text-destructive text-xs">
          {run.error}
        </p>
      ) : null}
    </div>
  );
}

function taskLabel(taskType: string) {
  return taskType.replaceAll(".", " ").replaceAll("_", " ");
}
