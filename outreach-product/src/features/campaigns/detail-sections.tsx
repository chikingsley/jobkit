import { CirclePause, CirclePlay, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import type {
  CampaignDetail,
  CampaignTarget,
  CampaignTargetPage,
} from "@/features/campaigns/types";
import { cn } from "@/lib/utils";

export type CampaignAction =
  | "begin_calibration"
  | "cancel"
  | "pause"
  | "resume"
  | "start";

export function CampaignNotices({ campaign }: { campaign: CampaignDetail }) {
  return (
    <>
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
    </>
  );
}

export function CampaignActions({
  action,
  busy,
  campaign,
}: {
  action: (value: CampaignAction) => Promise<void>;
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

export function CampaignSummaryMetrics({
  counts,
}: {
  counts: CampaignDetail["counts"];
}) {
  return (
    <dl
      aria-label="Campaign summary"
      className="grid grid-cols-2 overflow-hidden rounded-lg border bg-card sm:grid-cols-4"
    >
      <Metric
        className="border-r border-b sm:border-b-0"
        label="Total opportunities"
        value={counts.total}
      />
      <Metric
        className="border-b sm:border-r sm:border-b-0"
        label="Posted jobs"
        value={counts.advertised}
      />
      <Metric
        className="border-r"
        label="Direct contacts"
        value={counts.school}
      />
      <Metric label="Human replies" value={counts.humanReplies} />
    </dl>
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

export function CampaignPool({
  busy,
  campaign,
  loadMore,
  refresh,
  targetPage,
  targets,
}: {
  busy: string;
  campaign: CampaignDetail;
  loadMore: () => void;
  refresh: () => void;
  targetPage: CampaignTargetPage | null;
  targets: CampaignTarget[];
}) {
  return (
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
          onClick={refresh}
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
          onClick={loadMore}
          variant="outline"
        >
          {busy === "targets" ? "Loading…" : "Load more targets"}
        </Button>
      ) : null}
    </section>
  );
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

export function CampaignWritingRules({
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

export function CampaignStatusBadge({ status }: { status: string }) {
  return (
    <Badge variant={status === "running" ? "default" : "outline"}>
      {humanize(status)}
    </Badge>
  );
}

function humanize(value: string) {
  return value.replaceAll("_", " ");
}
