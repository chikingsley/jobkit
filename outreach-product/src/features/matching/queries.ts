import { useMutation, useQueryClient } from "@tanstack/react-query";
import { jobsKeys } from "@/features/jobs/queries";
import type {
  QualificationClaim,
  QualificationClaimAnswer,
} from "@/features/matching/claims";
import { apiJson } from "@/lib/api";

export interface QualificationClaimInput {
  answer: QualificationClaimAnswer | null;
  claimKey: string;
  kind: string;
  label: string;
}

export function useQualificationClaimMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: QualificationClaimInput) =>
      apiJson<{ claim: QualificationClaim | null }>(
        "/api/qualification-claims",
        {
          body: JSON.stringify(input),
          headers: { "content-type": "application/json" },
          method: "PUT",
        }
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: jobsKeys.all });
    },
  });
}
