import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { CampaignAction } from "@/features/campaigns/detail-sections";
import type {
  CampaignDetail,
  CampaignSetup,
  CampaignSummary,
  CampaignTargetPage,
} from "@/features/campaigns/types";
import { apiJson } from "@/lib/api";

const CAMPAIGN_ACTIVITY_REFRESH_MS = 1500;

export const campaignsKeys = {
  all: ["campaigns"] as const,
  detail: (campaignId: string) => ["campaigns", "detail", campaignId] as const,
  list: ["campaigns", "list"] as const,
  setup: ["campaigns", "setup"] as const,
  targets: (campaignId: string) =>
    ["campaigns", "detail", campaignId, "targets"] as const,
};

export function useCampaigns() {
  return useQuery({
    queryFn: async () =>
      (await apiJson<{ campaigns: CampaignSummary[] }>("/api/campaigns"))
        .campaigns,
    queryKey: campaignsKeys.list,
  });
}

export function useCampaignDetail(campaignId: string) {
  return useQuery({
    queryFn: async () =>
      (
        await apiJson<{ campaign: CampaignDetail }>(
          `/api/campaigns/${campaignId}`
        )
      ).campaign,
    queryKey: campaignsKeys.detail(campaignId),
    refetchInterval: (query) =>
      query.state.data?.dispatches.some(
        (dispatch) =>
          dispatch.status === "calibration" || dispatch.status === "drafting"
      )
        ? CAMPAIGN_ACTIVITY_REFRESH_MS
        : false,
  });
}

export function useCampaignSetup() {
  return useQuery({
    queryFn: async () =>
      (await apiJson<{ setup: CampaignSetup }>("/api/campaigns/setup")).setup,
    queryKey: campaignsKeys.setup,
  });
}

export function useCampaignTargets(campaignId: string) {
  return useInfiniteQuery({
    getNextPageParam: (lastPage: CampaignTargetPage) =>
      lastPage.nextOffset ?? undefined,
    initialPageParam: 0,
    queryFn: async ({ pageParam }) =>
      (
        await apiJson<{ targets: CampaignTargetPage }>(
          `/api/campaigns/${campaignId}/targets?offset=${pageParam}`
        )
      ).targets,
    queryKey: campaignsKeys.targets(campaignId),
  });
}

export function useCampaignAction(campaignId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (action: CampaignAction) =>
      apiJson<{ campaign: CampaignDetail; message: string }>(
        `/api/campaigns/${campaignId}/actions`,
        {
          body: JSON.stringify({ action, reason: "" }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }
      ),
    onSuccess: (payload) => {
      queryClient.setQueryData(
        campaignsKeys.detail(campaignId),
        payload.campaign
      );
    },
  });
}

export function useCreateCampaign() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      countryCodes: string[];
      dailyPace: number;
      firstFiveRequired: boolean;
      postedTargetPercent: number;
      stopAfterHumanReplies: number;
    }) =>
      apiJson<{ campaign: CampaignDetail; message: string }>("/api/campaigns", {
        body: JSON.stringify(input),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: campaignsKeys.list });
    },
  });
}
