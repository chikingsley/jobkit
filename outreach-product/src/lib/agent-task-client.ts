import type { ApiRequest } from "@/lib/api";

const AGENT_TASK_POLL_INTERVAL_MS = 1000;

interface AgentTaskRequestResult {
  error: string;
  id: string;
  result: unknown;
  status: "cancelled" | "claimed" | "completed" | "failed" | "queued";
}

export async function waitForAgentTask(request: ApiRequest, requestId: string) {
  const response = await request(`/api/agent-task-requests/${requestId}`);
  const payload = (await response.json()) as {
    taskRequest: AgentTaskRequestResult;
  };
  if (payload.taskRequest.status === "completed") {
    return payload.taskRequest.result;
  }
  if (
    payload.taskRequest.status === "failed" ||
    payload.taskRequest.status === "cancelled"
  ) {
    throw new Error(
      payload.taskRequest.error || "The Codex task did not complete"
    );
  }
  await new Promise((resolve) =>
    window.setTimeout(resolve, AGENT_TASK_POLL_INTERVAL_MS)
  );
  return waitForAgentTask(request, requestId);
}
