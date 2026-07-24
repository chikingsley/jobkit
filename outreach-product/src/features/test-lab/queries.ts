import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ClassificationReviewResponse,
  TestLabResponse,
} from "@/features/test-lab/types";
import { apiJson } from "@/lib/api";

const ACTIVE_RUN_REFRESH_MS = 2000;

export const testLabKeys = {
  all: ["test-lab"] as const,
  classificationReview: ["test-lab", "classification-review"] as const,
  delivery: ["test-lab", "delivery"] as const,
  overview: ["test-lab", "overview"] as const,
};

export interface DeliveryLabResponse {
  allowlist: Array<{
    createdAt: string;
    email: string;
    ownershipBasis: string;
  }>;
  captures: Array<{
    attachments: Array<{ filename: string }>;
    createdAt: string;
    events: Array<{
      createdAt: string;
      detail: string;
      eventType: string;
      id: string;
    }>;
    id: string;
    message: string;
    mimeSha256: string;
    recipient: string;
    sizeBytes: number;
    subject: string;
  }>;
  eligibleAddresses: Array<{
    email: string;
    ownershipBasis: string;
  }>;
}

export function useTestLabOverview() {
  return useQuery({
    queryFn: () => apiJson<TestLabResponse>("/api/test-lab"),
    queryKey: testLabKeys.overview,
    refetchInterval: (query) =>
      query.state.data?.summary.active ? ACTIVE_RUN_REFRESH_MS : false,
  });
}

export function useInvalidateTestLabOverview() {
  const queryClient = useQueryClient();
  return async () => {
    await queryClient.invalidateQueries({ queryKey: testLabKeys.overview });
  };
}

export function useClassificationReview() {
  return useQuery({
    queryFn: () =>
      apiJson<ClassificationReviewResponse>(
        "/api/test-lab/classification-review"
      ),
    queryKey: testLabKeys.classificationReview,
  });
}

export function useDeliveryLab() {
  return useQuery({
    queryFn: () => apiJson<DeliveryLabResponse>("/api/test-lab/delivery"),
    queryKey: testLabKeys.delivery,
  });
}

export function useReplayTestLabRun() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (runId: string) =>
      apiJson<{ message: string }>(`/api/test-lab/runs/${runId}/replay`, {
        method: "POST",
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: testLabKeys.overview });
    },
  });
}

export function useResetTestLab() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiJson<{ ok: boolean }>("/api/test-lab", { method: "DELETE" }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: testLabKeys.all });
    },
  });
}

export function useDeliveryAllowlistMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      action,
      email,
    }: {
      action: "add" | "remove";
      email: string;
    }) =>
      action === "add"
        ? apiJson<{ ok: boolean }>("/api/test-lab/delivery/allowlist", {
            body: JSON.stringify({ email }),
            headers: { "content-type": "application/json" },
            method: "POST",
          })
        : apiJson<{ ok: boolean }>(
            `/api/test-lab/delivery/allowlist/${encodeURIComponent(email)}`,
            { method: "DELETE" }
          ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: testLabKeys.delivery });
    },
  });
}

export function useCaptureDeliveryMime() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      attachmentDocumentIds: string[];
      message: string;
      recipient: string;
      subject: string;
    }) =>
      apiJson<{ message: string }>("/api/test-lab/delivery/captures", {
        body: JSON.stringify(input),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: testLabKeys.delivery });
    },
  });
}

export function useSimulateDeliveryEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      captureId,
      eventType,
    }: {
      captureId: string;
      eventType: "automated_reply" | "bounce" | "human_reply";
    }) =>
      apiJson<{ ok: boolean }>(
        `/api/test-lab/delivery/captures/${captureId}/events`,
        {
          body: JSON.stringify({ detail: "Test Lab simulation", eventType }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: testLabKeys.delivery });
    },
  });
}

export function useStartDocumentBenchmark() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      documentId: string;
      expectedText: string;
      variant: string;
    }) =>
      apiJson<{ message: string }>("/api/test-lab/document-runs", {
        body: JSON.stringify(input),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: testLabKeys.overview });
    },
  });
}
