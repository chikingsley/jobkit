import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type AutomationPolicy,
  AutomationPolicySchema,
} from "@/features/automation/schema";
import { apiJson } from "@/lib/api";

export const automationKeys = {
  policy: ["automation-policy"] as const,
};

interface AutomationPolicyData {
  policy: AutomationPolicy;
  updatedAt: string | null;
}

function parsePolicyPayload(payload: {
  policy: unknown;
  updatedAt: string | null;
}): AutomationPolicyData {
  return {
    policy: AutomationPolicySchema.parse(payload.policy),
    updatedAt: payload.updatedAt,
  };
}

export function useAutomationPolicy() {
  return useQuery({
    queryFn: async () =>
      parsePolicyPayload(
        await apiJson<{ policy: unknown; updatedAt: string | null }>(
          "/api/automation-policy"
        )
      ),
    queryKey: automationKeys.policy,
  });
}

export function useSaveAutomationPolicy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (draft: AutomationPolicy) =>
      parsePolicyPayload(
        await apiJson<{ policy: unknown; updatedAt: string }>(
          "/api/automation-policy",
          {
            body: JSON.stringify(draft),
            headers: { "content-type": "application/json" },
            method: "PUT",
          }
        )
      ),
    onSuccess: (saved) => {
      queryClient.setQueryData(automationKeys.policy, saved);
    },
  });
}
