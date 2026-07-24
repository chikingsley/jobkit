import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  MessageThreadDetail,
  MessageThreadSummary,
} from "@/features/messages/types";
import { apiJson } from "@/lib/api";

const THREADS_REFRESH_MS = 30_000;
const GMAIL_STATUS_REFRESH_MS = 60_000;

export const messagesKeys = {
  all: ["messages"] as const,
  thread: (threadId: string) => ["messages", "thread", threadId] as const,
  threads: ["messages", "threads"] as const,
};

export const gmailKeys = {
  status: ["gmail", "status"] as const,
};

export interface GmailStatus {
  available: boolean;
  connected: boolean;
  emailAddress: string;
  watch: null | {
    expirationAt: string;
    lastError: string;
    lastSyncedAt: string | null;
    status: "active" | "error" | "expired";
  };
}

export function useMessageThreads() {
  return useQuery({
    queryFn: async () =>
      (await apiJson<{ threads: MessageThreadSummary[] }>("/api/messages"))
        .threads,
    queryKey: messagesKeys.threads,
    refetchInterval: THREADS_REFRESH_MS,
  });
}

export function useMessageThread(threadId: string) {
  return useQuery({
    enabled: threadId !== "",
    queryFn: async () =>
      (
        await apiJson<{ thread: MessageThreadDetail }>(
          `/api/messages/threads/${encodeURIComponent(threadId)}`
        )
      ).thread,
    queryKey: messagesKeys.thread(threadId),
  });
}

export function useMarkThreadRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (threadId: string) =>
      apiJson<{ ok: boolean }>(
        `/api/messages/threads/${encodeURIComponent(threadId)}/read`,
        { method: "POST" }
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: messagesKeys.threads });
    },
  });
}

export function useGmailStatus() {
  return useQuery({
    queryFn: () => apiJson<GmailStatus>("/api/gmail/status"),
    queryKey: gmailKeys.status,
    refetchInterval: GMAIL_STATUS_REFRESH_MS,
  });
}

export function useStartGmailWatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiJson<{ messagesRecorded: number }>("/api/gmail/watch", {
        method: "POST",
      }),
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: gmailKeys.status });
    },
  });
}
