import {
  ChevronLeft,
  CirclePause,
  CirclePlay,
  ExternalLink,
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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { CampaignActivity } from "@/features/campaigns/activity";
import type {
  CampaignDetail,
  CampaignDispatch,
  CampaignSummary,
  CampaignTarget,
  CampaignTargetPage,
} from "@/features/campaigns/types";
import { MessageChanges, MessageText } from "@/features/jobs/message-diff";
import { SplitWorkspace } from "@/features/workspace/split-workspace";
import type { ApiRequest } from "@/lib/api";
import { cn } from "@/lib/utils";

export function CampaignsWorkspace({ request }: { request: ApiRequest }) {
  const { campaignId = "" } = useParams();
  const navigate = useNavigate();
  const [showList, setShowList] = useState(!campaignId);
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
  useEffect(() => {
    if (campaignId) {
      setShowList(false);
    }
  }, [campaignId]);

  return (
    <SplitWorkspace
      detail={
        selectedId ? (
          <CampaignDetailView
            campaignId={selectedId}
            onBack={() => setShowList(true)}
            onChanged={() => mutateCampaigns()}
            request={request}
          />
        ) : (
          <EmptyCampaigns onCreate={() => navigate("/campaigns/new")} />
        )
      }
      detailOpen={!showList && Boolean(selectedId)}
      list={
        <>
          <div className="flex items-center justify-between border-b px-4 py-3">
            <div>
              <h2 className="font-semibold text-sm">Campaigns</h2>
              <p className="text-muted-foreground text-xs">
                {campaigns?.length
                  ? `${campaigns.length} active and past campaign${campaigns.length === 1 ? "" : "s"}`
                  : "Choose markets and build a live outreach pool"}
              </p>
            </div>
            <Button
              aria-label="New campaign"
              onClick={() => navigate("/campaigns/new")}
              size="icon-sm"
            >
              <Plus />
            </Button>
          </div>
          <ScrollArea className="min-h-0 flex-1">
            <div className="flex flex-col gap-1 p-2">
              {campaigns?.map((campaign) => (
                <CampaignListItem
                  active={campaign.id === selectedId}
                  campaign={campaign}
                  key={campaign.id}
                  onSelect={() => {
                    navigate(`/campaigns/${campaign.id}`);
                    setShowList(false);
                  }}
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
          <div className="mt-0.5 truncate text-muted-foreground text-xs">
            {campaign.markets.map((market) => market.countryName).join(" · ")}
          </div>
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
    <>
      <div className="split-workspace-back border-b bg-background px-4 py-2">
        <Button onClick={onBack} variant="ghost">
          <ChevronLeft /> Campaigns
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-5 sm:px-6">
          <header className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="font-semibold text-2xl tracking-tight">
                  {campaign.name}
                </h1>
                <StatusBadge status={campaign.status} />
              </div>
              <p className="mt-1 text-muted-foreground text-sm">
                {campaign.markets
                  .map((market) => market.countryName)
                  .join(" · ")}{" "}
                · up to {campaign.dailyPace.toLocaleString()} per day · pause
                after {campaign.stopAfterHumanReplies.toLocaleString()} human
                replies
              </p>
            </div>
            <CampaignActions action={action} busy={busy} campaign={campaign} />
          </header>

          {campaign.pauseReason ? (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-amber-950 text-sm dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
              {campaign.pauseReason}
            </div>
          ) : null}

          {campaign.liveDeliveryEnabled ? null : (
            <Card>
              <CardHeader>
                <CardTitle>Live delivery is locked</CardTitle>
                <CardDescription>
                  Campaign setup, target review, Codex generation, revision,
                  packet capture, and simulated replies remain available. A
                  separate database authorization is required before JobKit can
                  start or resume Gmail delivery.
                </CardDescription>
              </CardHeader>
            </Card>
          )}

          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="Known pool" value={campaign.counts.total} />
            <Metric
              label="Advertised positions"
              value={campaign.counts.advertised}
            />
            <Metric
              label="Direct school contacts"
              value={campaign.counts.school}
            />
            <Metric
              label="Human replies"
              value={campaign.counts.humanReplies}
            />
          </section>

          <CampaignActivity replies={campaign.replies} runs={campaign.runs} />

          {campaign.status === "preparing" ? (
            <Card>
              <CardHeader>
                <CardTitle>Evaluating the campaign pool</CardTitle>
                <CardDescription>
                  JobKit is applying the same profile, preference,
                  qualification, and requirement evaluator used in Jobs. The
                  campaign becomes reviewable when every posted opportunity has
                  a stored match result.
                </CardDescription>
              </CardHeader>
            </Card>
          ) : null}

          {campaign.status === "draft" ? (
            <Card>
              <CardHeader>
                <CardTitle>Ready for calibration</CardTitle>
                <CardDescription>
                  {campaign.firstFiveRequired
                    ? "JobKit will sample up to five distinct deliveries across the selected markets and routes. Nothing is sent during calibration."
                    : "This campaign does not require first-five review. Prepare it for launch without sending anything."}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  disabled={Boolean(busy)}
                  onClick={() => void action("begin_calibration")}
                >
                  <MailCheck />
                  {campaign.firstFiveRequired
                    ? "Review the first five"
                    : "Prepare campaign"}
                </Button>
              </CardContent>
            </Card>
          ) : null}

          {campaign.dispatches.length > 0 ? (
            <section className="grid gap-3">
              <div>
                <h2 className="font-semibold">Calibration and delivery</h2>
                <p className="text-muted-foreground text-sm">
                  Each dispatch is one recipient interaction. ANESL references
                  are bundled into one instruction-compliant email.
                </p>
              </div>
              {campaign.dispatches.map((dispatch, index) => (
                <DispatchCard
                  campaignId={campaign.id}
                  dispatch={dispatch}
                  index={index}
                  key={dispatch.id}
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
                  Showing {targets.length.toLocaleString()} of{" "}
                  {(
                    targetPage?.total ?? campaign.counts.total
                  ).toLocaleString()}{" "}
                  stored targets. Pagination changes the view, never the
                  campaign pool.
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
            <Card>
              <CardContent className="p-0">
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
              </CardContent>
            </Card>
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
    </>
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

function DispatchCard({
  campaignId,
  dispatch,
  index,
  onChanged,
  request,
}: {
  campaignId: string;
  dispatch: CampaignDispatch;
  index: number;
  onChanged: (campaign?: CampaignDetail) => Promise<void>;
  request: ApiRequest;
}) {
  const [instruction, setInstruction] = useState("");
  const [scope, setScope] = useState<"campaign" | "future" | "message">(
    "message"
  );
  const [busy, setBusy] = useState("");

  async function revise() {
    setBusy("revise");
    try {
      const response = await request(
        `/api/campaigns/${campaignId}/dispatches/${dispatch.id}/revisions`,
        {
          body: JSON.stringify({
            dispatchId: dispatch.id,
            instruction,
            scope,
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }
      );
      const payload = (await response.json()) as { message: string };
      setInstruction("");
      await onChanged();
      toast.success(payload.message);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Revision could not be queued"
      );
    } finally {
      setBusy("");
    }
  }

  async function approve() {
    setBusy("approve");
    try {
      const response = await request(
        `/api/campaigns/${campaignId}/dispatches/${dispatch.id}/approve`,
        { method: "POST" }
      );
      const payload = (await response.json()) as {
        campaign: CampaignDetail;
        message: string;
      };
      await onChanged(payload.campaign);
      toast.success(payload.message);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Message could not be approved"
      );
    } finally {
      setBusy("");
    }
  }

  return (
    <Card>
      <CardHeader className="gap-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Message {index + 1}</CardTitle>
            <CardDescription>
              {dispatch.targets.map((target) => target.label).join(" · ")}
            </CardDescription>
          </div>
          <div className="flex gap-2">
            {dispatch.routeStrategy === "anesl_bundle" ? (
              <Badge variant="secondary">ANESL bundle</Badge>
            ) : null}
            <Badge variant="outline">{humanize(dispatch.status)}</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3">
        {dispatch.message ? (
          <>
            <MessageText
              highlightChanges={Boolean(dispatch.message.previousMessage)}
              message={dispatch.message.message}
              previousMessage={dispatch.message.previousMessage}
            />
            <MessageChanges
              message={dispatch.message.message}
              previousMessage={dispatch.message.previousMessage}
            />
            {dispatch.message.changeSummary ? (
              <div className="rounded-lg bg-muted/60 p-3 text-sm">
                <div className="font-medium">What changed</div>
                <p className="mt-1 text-muted-foreground">
                  {dispatch.message.changeSummary}
                </p>
              </div>
            ) : null}
          </>
        ) : (
          <div className="rounded-lg border border-dashed px-4 py-6 text-center text-muted-foreground text-sm">
            Waiting for the paired Codex runner to prepare this message.
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {dispatch.targets.map((target) =>
            target.sourceUrl ? (
              <Button
                key={target.id}
                render={
                  <a href={target.sourceUrl} rel="noreferrer" target="_blank" />
                }
                size="sm"
                variant="outline"
              >
                <ExternalLink /> Open source
              </Button>
            ) : null
          )}
        </div>
        {dispatch.message && dispatch.status === "review" ? (
          <div className="grid gap-3 rounded-lg border p-3">
            <Textarea
              aria-label={`Revision instruction for message ${index + 1}`}
              className="min-h-20"
              onChange={(event) => setInstruction(event.target.value)}
              placeholder="Describe one change. The revised message will replace this one in place."
              value={instruction}
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Select
                onValueChange={(value) =>
                  setScope(value as "campaign" | "future" | "message")
                }
                value={scope}
              >
                <SelectTrigger aria-label="Revision scope">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="message">This message</SelectItem>
                    <SelectItem value="campaign">Remaining campaign</SelectItem>
                    <SelectItem value="future">Future campaigns</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
              <div className="flex gap-2">
                <Button
                  disabled={Boolean(busy) || !instruction.trim()}
                  onClick={() => void revise()}
                  variant="secondary"
                >
                  {busy === "revise" ? "Revising…" : "Revise"}
                </Button>
                <Button disabled={Boolean(busy)} onClick={() => void approve()}>
                  <MailCheck />
                  {busy === "approve" ? "Approving…" : "Approve"}
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function TargetRow({ target }: { target: CampaignTarget }) {
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
          {target.matchLabel ? (
            <Badge variant="outline">
              {target.matchLabel}
              {target.matchScore === null ? "" : ` · ${target.matchScore}`}
            </Badge>
          ) : null}
        </div>
        <p className="mt-1 text-muted-foreground text-xs">
          {target.description || target.destination || target.countryCode}
        </p>
        {target.holdReason ? (
          <p className="mt-1 text-amber-700 text-xs dark:text-amber-300">
            {target.holdReason}
          </p>
        ) : null}
      </div>
      <Badge variant="outline">{humanize(target.status)}</Badge>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="font-semibold text-2xl tabular-nums">
          {value.toLocaleString()}
        </div>
        <div className="mt-1 text-muted-foreground text-xs">{label}</div>
      </CardContent>
    </Card>
  );
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
