import { ChevronLeft, MailCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CampaignActivity } from "@/features/campaigns/activity";
import {
  type CampaignAction,
  CampaignActions,
  CampaignNotices,
  CampaignPool,
  CampaignStatusBadge,
  CampaignSummaryMetrics,
  CampaignWritingRules,
} from "@/features/campaigns/detail-sections";
import { CampaignDispatchCard } from "@/features/campaigns/dispatch-card";
import type {
  CampaignDetail,
  CampaignTarget,
  CampaignTargetPage,
} from "@/features/campaigns/types";
import type { ApiRequest } from "@/lib/api";

export function CampaignDetailView({
  campaignId,
  onBack,
  onChanged,
  request,
}: {
  campaignId: string;
  onBack: () => void;
  onChanged: () => Promise<unknown>;
  request: ApiRequest;
}) {
  const [busy, setBusy] = useState("");
  const [hiddenDispatchIds, setHiddenDispatchIds] = useState<string[]>([]);
  const [pendingFocusId, setPendingFocusId] = useState("");
  const [targets, setTargets] = useState<CampaignTarget[]>([]);
  const [targetPage, setTargetPage] = useState<CampaignTargetPage | null>(null);
  const {
    data: campaign,
    isLoading,
    mutate,
  } = useSWR(
    `/api/campaigns/${campaignId}`,
    async (path) => {
      const payload = (await (await request(path)).json()) as {
        campaign: CampaignDetail;
      };
      return payload.campaign;
    },
    {
      refreshInterval: (latest) =>
        latest?.dispatches.some((dispatch) =>
          ["calibration", "drafting"].includes(dispatch.status)
        )
          ? 1500
          : 0,
    }
  );

  useEffect(() => {
    setTargets([]);
    setTargetPage(null);
    void loadTargetPage(0, true);

    async function loadTargetPage(offset: number, replace: boolean) {
      const response = await request(
        `/api/campaigns/${campaignId}/targets?offset=${offset}`
      );
      const payload = (await response.json()) as {
        targets: CampaignTargetPage;
      };
      setTargetPage(payload.targets);
      setTargets((current) =>
        replace ? payload.targets.items : [...current, ...payload.targets.items]
      );
    }
  }, [campaignId, request]);

  const activeDispatches = activeCampaignDispatches(
    campaign,
    hiddenDispatchIds
  );

  useEffect(() => {
    if (!pendingFocusId) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>(
          `[data-campaign-dispatch-id="${pendingFocusId}"]`
        )
        ?.focus({ preventScroll: true });
      setPendingFocusId("");
    });
    return () => cancelAnimationFrame(frame);
  }, [pendingFocusId]);

  async function loadMore() {
    if (
      targetPage?.nextOffset === null ||
      targetPage?.nextOffset === undefined
    ) {
      return;
    }
    setBusy("targets");
    try {
      const response = await request(
        `/api/campaigns/${campaignId}/targets?offset=${targetPage.nextOffset}`
      );
      const payload = (await response.json()) as {
        targets: CampaignTargetPage;
      };
      setTargetPage(payload.targets);
      setTargets((current) => [...current, ...payload.targets.items]);
    } finally {
      setBusy("");
    }
  }

  async function action(nextAction: CampaignAction) {
    setBusy(nextAction);
    try {
      const response = await request(`/api/campaigns/${campaignId}/actions`, {
        body: JSON.stringify({ action: nextAction, reason: "" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const payload = (await response.json()) as {
        campaign: CampaignDetail;
        message: string;
      };
      await mutate(payload.campaign, { revalidate: false });
      await onChanged();
      toast.success(payload.message);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Campaign could not be updated"
      );
    } finally {
      setBusy("");
    }
  }

  if (isLoading || !campaign) {
    return (
      <div className="grid min-h-[24rem] flex-1 place-items-center text-muted-foreground text-sm">
        Loading campaign…
      </div>
    );
  }

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-5 sm:px-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-2">
            <Button
              aria-label="Back to campaigns"
              className="split-workspace-back -ml-2 shrink-0"
              onClick={onBack}
              size="icon-sm"
              variant="ghost"
            >
              <ChevronLeft />
            </Button>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="font-semibold text-2xl tracking-tight">
                  {campaign.name}
                </h1>
                <CampaignStatusBadge status={campaign.status} />
              </div>
              <p className="mt-1 text-muted-foreground text-sm">
                Up to {campaign.dailyPace.toLocaleString()} per day · pause
                after {campaign.stopAfterHumanReplies.toLocaleString()} human
                replies
              </p>
            </div>
          </div>
          <CampaignActions action={action} busy={busy} campaign={campaign} />
        </header>

        <CampaignNotices campaign={campaign} />
        <CampaignSummaryMetrics counts={campaign.counts} />
        <CampaignActivity replies={campaign.replies} runs={campaign.runs} />

        {campaign.status === "preparing" ? (
          <p
            className="border-y py-4 text-muted-foreground text-sm"
            role="status"
          >
            Evaluating the campaign pool…
          </p>
        ) : null}

        {campaign.status === "draft" ? (
          <section className="flex flex-wrap items-center justify-between gap-3 border-y py-4">
            <p className="text-muted-foreground text-sm">
              {campaign.firstFiveRequired
                ? "Review sample messages before launch."
                : "Prepare this campaign for launch."}
            </p>
            <Button
              disabled={Boolean(busy)}
              onClick={() => void action("begin_calibration")}
            >
              <MailCheck />
              {campaign.firstFiveRequired
                ? "Review the first five"
                : "Prepare campaign"}
            </Button>
          </section>
        ) : null}

        <CampaignWritingRules guidance={campaign.guidance} />

        {activeDispatches.length > 0 ? (
          <section className="grid gap-3">
            <h2 className="font-semibold">Messages to review</h2>
            {activeDispatches.map((dispatch, index) => (
              <CampaignDispatchCard
                campaignId={campaign.id}
                dispatch={dispatch}
                index={index}
                key={dispatch.id}
                onApproveFailed={() => {
                  setHiddenDispatchIds((current) =>
                    current.filter((id) => id !== dispatch.id)
                  );
                  setPendingFocusId(dispatch.id);
                }}
                onApproveStart={() => {
                  const currentIndex = activeDispatches.findIndex(
                    (candidate) => candidate.id === dispatch.id
                  );
                  const next =
                    activeDispatches[currentIndex + 1] ??
                    activeDispatches[currentIndex - 1];
                  setPendingFocusId(next?.id ?? "");
                  setHiddenDispatchIds((current) => [...current, dispatch.id]);
                }}
                onChanged={async (nextCampaign) => {
                  if (nextCampaign) {
                    await mutate(nextCampaign, { revalidate: false });
                  } else {
                    await mutate();
                  }
                  await onChanged();
                }}
                request={request}
              />
            ))}
          </section>
        ) : null}

        <CampaignPool
          busy={busy}
          campaign={campaign}
          loadMore={() => void loadMore()}
          refresh={() => void mutate()}
          targetPage={targetPage}
          targets={targets}
        />
      </div>
    </ScrollArea>
  );
}

function activeCampaignDispatches(
  campaign: CampaignDetail | undefined,
  hiddenDispatchIds: string[]
) {
  return (campaign?.dispatches ?? []).filter(
    (dispatch) =>
      ["calibration", "drafting", "review"].includes(dispatch.status) &&
      !hiddenDispatchIds.includes(dispatch.id)
  );
}
