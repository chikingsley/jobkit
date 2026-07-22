import {
  ChevronLeft,
  CirclePause,
  CirclePlay,
  Globe2,
  MailCheck,
  Plus,
  RefreshCw,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import useSWR from "swr";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { CampaignActivity } from "@/features/campaigns/activity";
import { CampaignDispatchCard } from "@/features/campaigns/dispatch-card";
import type {
  CampaignDetail,
  CampaignSummary,
  CampaignTarget,
  CampaignTargetPage,
} from "@/features/campaigns/types";
import { SplitWorkspace } from "@/features/workspace/split-workspace";
import type { ApiRequest } from "@/lib/api";
import { cn } from "@/lib/utils";

export function CampaignsWorkspace({ request }: { request: ApiRequest }) {
  const { campaignId = "" } = useParams();
  const navigate = useNavigate();
  const {
    data: campaigns,
    isLoading,
    mutate: mutateCampaigns,
  } = useSWR("/api/campaigns", async (path) => {
    const payload = (await (await request(path)).json()) as {
      campaigns: CampaignSummary[];
    };
    return payload.campaigns;
  });

  const selectedId = campaignId || campaigns?.[0]?.id || "";

  return (
    <SplitWorkspace
      detail={
        selectedId ? (
          <CampaignDetailView
            campaignId={selectedId}
            onBack={() => navigate("/campaigns")}
            onChanged={() => mutateCampaigns()}
            request={request}
          />
        ) : (
          <EmptyCampaigns onCreate={() => navigate("/campaigns/new")} />
        )
      }
      detailOpen={Boolean(campaignId)}
      list={
        <>
          <div className="flex items-center justify-between border-b px-4 py-3">
            <p className="text-muted-foreground text-xs">
              {campaigns?.length
                ? `${campaigns.length} campaign${campaigns.length === 1 ? "" : "s"}`
                : "No campaigns"}
            </p>
            <div className="flex items-center gap-1">
              <Button
                aria-label="Markets"
                onClick={() => navigate("/campaigns/markets")}
                size="icon-sm"
                variant="ghost"
              >
                <Globe2 />
              </Button>
              <Button
                aria-label="New campaign"
                onClick={() => navigate("/campaigns/new")}
                size="icon-sm"
              >
                <Plus />
              </Button>
            </div>
          </div>
          <ScrollArea className="min-h-0 flex-1">
            <div className="flex flex-col gap-1 p-2">
              {campaigns?.map((campaign) => (
                <CampaignListItem
                  active={campaign.id === selectedId}
                  campaign={campaign}
                  key={campaign.id}
                  onSelect={() => navigate(`/campaigns/${campaign.id}`)}
                />
              ))}
              {isLoading ? (
                <p className="px-3 py-8 text-center text-muted-foreground text-sm">
                  Loading campaigns…
                </p>
              ) : null}
              {campaigns && campaigns.length === 0 ? (
                <div className="px-3 py-8 text-center">
                  <p className="text-muted-foreground text-sm">
                    No campaigns yet.
                  </p>
                  <Button
                    className="mt-3"
                    onClick={() => navigate("/campaigns/new")}
                    size="sm"
                  >
                    <Plus /> New campaign
                  </Button>
                </div>
              ) : null}
            </div>
          </ScrollArea>
        </>
      }
    />
  );
}

function CampaignListItem({
  active,
  campaign,
  onSelect,
}: {
  active: boolean;
  campaign: CampaignSummary;
  onSelect: () => void;
}) {
  return (
    <button
      className={cn(
        "w-full rounded-lg px-3 py-3 text-left transition-colors hover:bg-muted",
        active && "bg-muted"
      )}
      onClick={onSelect}
      type="button"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-medium text-sm">{campaign.name}</div>
        </div>
        <StatusBadge status={campaign.status} />
      </div>
      <div className="mt-2 flex gap-3 text-muted-foreground text-xs">
        <span>{campaign.counts.sent.toLocaleString()} sent</span>
        <span>{campaign.counts.remaining.toLocaleString()} remaining</span>
        <span>{campaign.counts.humanReplies.toLocaleString()} replies</span>
      </div>
    </button>
  );
}

function CampaignDetailView({
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

  const activeDispatches = (campaign?.dispatches ?? []).filter(
    (dispatch) =>
      ["calibration", "drafting", "review"].includes(dispatch.status) &&
      !hiddenDispatchIds.includes(dispatch.id)
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

  async function action(
    nextAction: "begin_calibration" | "cancel" | "pause" | "resume" | "start"
  ) {
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
                <StatusBadge status={campaign.status} />
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

        {campaign.pauseReason ? (
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-amber-950 text-sm dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
            {campaign.pauseReason}
          </div>
        ) : null}

        {campaign.liveDeliveryEnabled ? null : (
          <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-amber-950 text-sm dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
            Live delivery is locked. Review and simulation remain available.
          </p>
        )}

        <dl
          aria-label="Campaign summary"
          className="grid grid-cols-2 overflow-hidden rounded-lg border bg-card sm:grid-cols-4"
        >
          <Metric
            className="border-r border-b sm:border-b-0"
            label="Total opportunities"
            value={campaign.counts.total}
          />
          <Metric
            className="border-b sm:border-r sm:border-b-0"
            label="Posted jobs"
            value={campaign.counts.advertised}
          />
          <Metric
            className="border-r"
            label="Direct contacts"
            value={campaign.counts.school}
          />
          <Metric label="Human replies" value={campaign.counts.humanReplies} />
        </dl>

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

        <section className="grid gap-3">
          <div className="flex items-end justify-between gap-3">
            <div>
              <h2 className="font-semibold">Campaign pool</h2>
              <p className="text-muted-foreground text-sm">
                {targets.length.toLocaleString()} of{" "}
                {(targetPage?.total ?? campaign.counts.total).toLocaleString()}{" "}
                targets
              </p>
            </div>
            <Button
              aria-label="Refresh campaign"
              onClick={() => void mutate()}
              size="icon-sm"
              variant="ghost"
            >
              <RefreshCw />
            </Button>
          </div>
          <div className="overflow-hidden rounded-lg border">
            {targets.map((target, index) => (
              <div key={target.id}>
                {index > 0 ? <Separator /> : null}
                <TargetRow target={target} />
              </div>
            ))}
            {targets.length === 0 ? (
              <p className="px-4 py-10 text-center text-muted-foreground text-sm">
                No targets are stored in this campaign.
              </p>
            ) : null}
          </div>
          {targetPage?.hasMore ? (
            <Button
              disabled={busy === "targets"}
              onClick={() => void loadMore()}
              variant="outline"
            >
              {busy === "targets" ? "Loading…" : "Load more targets"}
            </Button>
          ) : null}
        </section>
      </div>
    </ScrollArea>
  );
}

function CampaignActions({
  action,
  busy,
  campaign,
}: {
  action: (
    value: "begin_calibration" | "cancel" | "pause" | "resume" | "start"
  ) => Promise<void>;
  busy: string;
  campaign: CampaignDetail;
}) {
  if (campaign.status === "running") {
    return (
      <Button
        disabled={Boolean(busy)}
        onClick={() => void action("pause")}
        variant="outline"
      >
        <CirclePause /> Pause
      </Button>
    );
  }
  if (campaign.status === "paused") {
    return (
      <Button
        disabled={Boolean(busy) || !campaign.liveDeliveryEnabled}
        onClick={() => void action("resume")}
      >
        <CirclePlay /> Resume
      </Button>
    );
  }
  if (campaign.status === "ready") {
    return (
      <Button
        disabled={Boolean(busy) || !campaign.liveDeliveryEnabled}
        onClick={() => void action("start")}
      >
        <CirclePlay /> Start campaign
      </Button>
    );
  }
  return null;
}

function TargetRow({ target }: { target: CampaignTarget }) {
  const holdReason = target.holdReason.startsWith("Campaign matching result:")
    ? null
    : target.holdReason;
  return (
    <div className="flex items-start justify-between gap-4 px-4 py-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-sm">{target.label}</span>
          <Badge variant="secondary">
            {target.sourceKind === "advertised" ? "Posted" : "School outreach"}
          </Badge>
          {target.routeStrategy === "anesl_bundle" ? (
            <Badge variant="outline">ANESL</Badge>
          ) : null}
        </div>
        <p className="mt-1 text-muted-foreground text-xs">
          {target.description || target.destination || target.countryCode}
        </p>
        {holdReason ? (
          <p className="mt-1 text-amber-700 text-xs dark:text-amber-300">
            {holdReason}
          </p>
        ) : null}
      </div>
      <Badge variant="outline">{humanize(target.status)}</Badge>
    </div>
  );
}

function Metric({
  className,
  label,
  value,
}: {
  className?: string;
  label: string;
  value: number;
}) {
  return (
    <div className={cn("min-w-0 px-4 py-3", className)}>
      <dd className="font-semibold text-xl tabular-nums">
        {value.toLocaleString()}
      </dd>
      <dt className="mt-0.5 text-muted-foreground text-xs leading-4">
        {label}
      </dt>
    </div>
  );
}

function CampaignWritingRules({
  guidance,
}: {
  guidance: CampaignDetail["guidance"];
}) {
  const rules = Array.from(
    new Map(
      guidance
        .filter((item) => item.status === "accepted")
        .map((item) => [`${item.scope}:${item.instruction}`, item])
    ).values()
  );
  if (rules.length === 0) {
    return null;
  }
  return (
    <details className="group border-y py-3 text-sm">
      <summary className="cursor-pointer list-none font-medium marker:content-none">
        <span className="inline-flex items-center gap-2">
          <span
            aria-hidden
            className="transition-transform group-open:rotate-90"
          >
            ▶
          </span>
          Writing rules
          <span className="text-muted-foreground">{rules.length}</span>
        </span>
      </summary>
      <ul className="mt-3 grid gap-3 pl-5">
        {rules.map((rule) => (
          <li
            className="grid gap-1 sm:grid-cols-[1fr_auto] sm:gap-4"
            key={rule.id}
          >
            <span className="leading-6">{rule.instruction}</span>
            <span className="text-muted-foreground text-xs">
              {guidanceScopeLabel(rule.scope)}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function guidanceScopeLabel(scope: "campaign" | "future" | "message") {
  if (scope === "future") {
    return "All campaigns";
  }
  if (scope === "campaign") {
    return "This campaign";
  }
  return "Source message";
}

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant={status === "running" ? "default" : "outline"}>
      {humanize(status)}
    </Badge>
  );
}

function EmptyCampaigns({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="grid min-h-[28rem] flex-1 place-items-center p-8 text-center">
      <div className="max-w-md">
        <h1 className="font-semibold text-2xl">
          Choose markets and let it run
        </h1>
        <p className="mt-2 text-muted-foreground text-sm leading-6">
          Build a campaign from every currently eligible posted opportunity and
          verified school contact, calibrate the first five messages, then watch
          delivery and replies in one place.
        </p>
        <Button className="mt-5" onClick={onCreate}>
          <Plus /> New campaign
        </Button>
      </div>
    </div>
  );
}

function humanize(value: string) {
  return value.replaceAll("_", " ");
}
