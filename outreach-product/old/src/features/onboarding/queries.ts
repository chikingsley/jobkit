import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import type { OnboardingState } from "@/features/onboarding/schema";
import { apiJson } from "@/lib/api";

const IMPORT_STATUS_REFRESH_MS = 1500;

export const onboardingKeys = {
  gate: ["onboarding", "gate"] as const,
  importStatus: ["onboarding", "import-status"] as const,
};

export function useOnboardingGateState() {
  return useQuery({
    queryFn: () => apiJson<OnboardingState>("/api/onboarding"),
    queryKey: onboardingKeys.gate,
    refetchOnWindowFocus: false,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export function useMarkOnboardingComplete() {
  const queryClient = useQueryClient();
  return useCallback(
    (completedAt: string) => {
      queryClient.setQueryData<OnboardingState>(onboardingKeys.gate, (state) =>
        state ? { ...state, completedAt } : state
      );
    },
    [queryClient]
  );
}

export function useProfileImportStatus(enabled: boolean) {
  return useQuery({
    enabled,
    queryFn: () => apiJson<OnboardingState>("/api/onboarding"),
    queryKey: onboardingKeys.importStatus,
    refetchInterval: IMPORT_STATUS_REFRESH_MS,
  });
}
