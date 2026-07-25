import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AgentCapability } from "@/features/agents/schema";
import { apiJson } from "@/lib/api";

const RUNNERS_REFRESH_MS = 3000;
const ACTIVE_TASK_REFRESH_MS = 2000;
const RUNNER_ONLINE_WINDOW_MS = 60 * 1000;

export const agentsKeys = {
  runners: ["agent-runners"] as const,
  tasks: ["agent-tasks"] as const,
};

export interface AgentRunnerSummary {
  capabilities: AgentCapability[];
  codexVersion: string;
  createdAt: string;
  id: string;
  lastSeenAt: string | null;
  name: string;
  revokedAt: string | null;
}

export interface AgentPairing {
  code: string;
  expiresAt: string;
}

export type AgentTaskStatus =
  | "cancelled"
  | "claimed"
  | "completed"
  | "failed"
  | "queued";

export interface AgentTaskRunSummary {
  completedAt: string | null;
  id: string;
  model: string;
  promptVersion: string;
  reasoningEffort: string;
  runnerName: string;
  startedAt: string;
  status: string;
}

export interface AgentTaskRequestSummary {
  completedAt: string | null;
  createdAt: string;
  error: string;
  id: string;
  run: AgentTaskRunSummary | null;
  status: AgentTaskStatus;
  subjectId: string;
  subjectType: string;
  taskType: string;
  updatedAt: string;
}

export interface AutonomousTaskSummary {
  completedAt: string | null;
  error: string;
  id: string;
  model: string;
  promptVersion: string;
  reasoningEffort: string;
  runnerName: string;
  sourceTaskId: string;
  startedAt: string;
  status: string;
  taskType: string;
}

export interface AgentTaskHistoryResponse {
  autonomousRuns: AutonomousTaskSummary[];
  requests: AgentTaskRequestSummary[];
}

export function isRunnerOnline(runner: AgentRunnerSummary) {
  return Boolean(
    !runner.revokedAt &&
      runner.lastSeenAt &&
      Date.parse(runner.lastSeenAt) >= Date.now() - RUNNER_ONLINE_WINDOW_MS
  );
}

export function isActiveAgentTask(task: AgentTaskRequestSummary) {
  return task.status === "queued" || task.status === "claimed";
}

export function useAgentRunners() {
  const result = useQuery({
    queryFn: () =>
      apiJson<{ runners: AgentRunnerSummary[] }>("/api/agent-runners"),
    queryKey: agentsKeys.runners,
    refetchInterval: RUNNERS_REFRESH_MS,
  });
  const runners = result.data?.runners ?? [];
  const activeRunners = runners.filter(isRunnerOnline);
  return {
    activeRunners,
    hasCapability: (capability: AgentCapability) =>
      activeRunners.some((runner) => runner.capabilities.includes(capability)),
    isLoading: result.isLoading,
    runners,
  };
}

export function useAgentTaskHistory() {
  return useQuery({
    queryFn: () => apiJson<AgentTaskHistoryResponse>("/api/agent-tasks"),
    queryKey: agentsKeys.tasks,
    refetchInterval: (query) =>
      query.state.data?.requests.some(isActiveAgentTask)
        ? ACTIVE_TASK_REFRESH_MS
        : false,
  });
}

export function useCreateAgentPairing() {
  return useMutation({
    mutationFn: (capabilities: AgentCapability[]) =>
      apiJson<{ message: string; pairing: AgentPairing }>(
        "/api/agent-runner-pairings",
        {
          body: JSON.stringify({ capabilities }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }
      ),
  });
}

export function useRevokeAgentRunner() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (runnerId: string) =>
      apiJson<{ ok: boolean }>(`/api/agent-runners/${runnerId}`, {
        method: "DELETE",
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: agentsKeys.runners });
    },
  });
}

export function useAgentTaskMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      action,
      taskId,
    }: {
      action: "cancel" | "retry";
      taskId: string;
    }) =>
      apiJson<{ ok: boolean }>(
        action === "retry"
          ? `/api/agent-task-requests/${taskId}/retry`
          : `/api/agent-task-requests/${taskId}`,
        { method: action === "retry" ? "POST" : "DELETE" }
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: agentsKeys.tasks });
    },
  });
}
