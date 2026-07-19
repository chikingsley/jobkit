import {
  ArrowLeft,
  Check,
  CirclePause,
  ExternalLink,
  RotateCcw,
} from "lucide-react";
import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import useSWR from "swr";
import { SettingsPage } from "@/components/settings-page";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { CountryCampaignTargetDecision } from "@/features/countries/schema";
import type {
  CountryCampaignDetail,
  CountryCampaignTarget,
} from "@/features/countries/types";
import { humanize } from "@/features/jobs/format";
import type { ApiRequest } from "@/lib/api";

const targetFilters = ["all", "review", "approved", "held"] as const;
type TargetFilter = (typeof targetFilters)[number];

export function CountryCampaignView({ request }: { request: ApiRequest }) {
  const { campaignId = "", countryCode = "" } = useParams();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<TargetFilter>("all");
  const [busy, setBusy] = useState("");
  const { data, isLoading, mutate } = useSWR(
    campaignId ? `/api/country-campaigns/${campaignId}` : null,
    async (path) =>
      (
        (await (await request(path)).json()) as {
          campaign: CountryCampaignDetail;
        }
      ).campaign
  );

  async function decide(
    targetId: string,
    decision: CountryCampaignTargetDecision
  ) {
    const busyKey = `${targetId}:${decision.status}`;
    setBusy(busyKey);
    try {
      const response = await request(
        `/api/country-campaigns/${campaignId}/targets/${targetId}`,
        {
          body: JSON.stringify(decision),
          headers: { "content-type": "application/json" },
          method: "PATCH",
        }
      );
      const result = (await response.json()) as {
        campaign: CountryCampaignDetail;
        message: string;
      };
      await mutate(result.campaign, { revalidate: false });
      toast.success(result.message);
      return true;
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Target could not be updated"
      );
      return false;
    } finally {
      setBusy("");
    }
  }

  if (isLoading || !data) {
    return (
      <SettingsPage
        description="Loading the saved target set and review decisions."
        title="Campaign"
      >
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            Loading campaign…
          </CardContent>
        </Card>
      </SettingsPage>
    );
  }

  const visibleTargets = data.targets.filter(
    (target) => filter === "all" || target.status === filter
  );
  const reviewCount = data.targetCounts.review + data.targetCounts.pending;

  return (
    <SettingsPage
      description="Inspect the frozen target set. Approving or holding a target is reversible until execution starts."
      title={`${data.countryName} campaign`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button
          onClick={() => navigate(`/countries/${countryCode}`)}
          variant="ghost"
        >
          <ArrowLeft /> {data.countryName}
        </Button>
        <Badge variant="outline">{humanize(data.status)}</Badge>
      </div>

      <CampaignSummary campaign={data} reviewCount={reviewCount} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs
          onValueChange={(value) => {
            if (isTargetFilter(value)) {
              setFilter(value);
            }
          }}
          value={filter}
        >
          <TabsList>
            <TabsTrigger value="all">All {data.targetCount}</TabsTrigger>
            <TabsTrigger value="review">Review {reviewCount}</TabsTrigger>
            <TabsTrigger value="approved">
              Approved {data.targetCounts.approved}
            </TabsTrigger>
            <TabsTrigger value="held">
              Held {data.targetCounts.held}
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <span className="text-muted-foreground text-sm">
          {visibleTargets.length} visible
        </span>
      </div>

      {visibleTargets.length > 0 ? (
        <ItemGroup>
          {visibleTargets.map((target) => (
            <CampaignTargetItem
              busy={busy}
              key={target.id}
              onDecision={(decision) => decide(target.id, decision)}
              target={target}
            />
          ))}
        </ItemGroup>
      ) : (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            No targets have this status.
          </CardContent>
        </Card>
      )}
    </SettingsPage>
  );
}

function CampaignSummary({
  campaign,
  reviewCount,
}: {
  campaign: CountryCampaignDetail;
  reviewCount: number;
}) {
  const sources = [
    campaign.includeOpenPositions ? "advertised positions" : "",
    campaign.includeSchoolOutreach ? "verified school contacts" : "",
  ].filter(Boolean);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Review target set</CardTitle>
        <CardDescription>
          {sources.join(" and ") || "No sources"} · created{" "}
          {formatDate(campaign.createdAt)}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        <Badge variant="secondary">{reviewCount} need review</Badge>
        <Badge variant="outline">
          {humanize(campaign.executionMode)} execution
        </Badge>
        <Badge variant="outline">
          Email {campaign.policy.email.mode} ·{" "}
          {campaign.policy.email.dailyLimit}/day
        </Badge>
        <Badge variant="outline">
          Minimum {campaign.policy.minimumFit} match
        </Badge>
        {campaign.sweepStatus ? (
          <Badge variant="outline">
            Refresh {humanize(campaign.sweepStatus)}
          </Badge>
        ) : null}
      </CardContent>
    </Card>
  );
}

function CampaignTargetItem({
  busy,
  onDecision,
  target,
}: {
  busy: string;
  onDecision: (decision: CountryCampaignTargetDecision) => Promise<boolean>;
  target: CountryCampaignTarget;
}) {
  const mutable = !["replied", "sent", "skipped"].includes(target.status);
  return (
    <Item variant="outline">
      <ItemContent>
        <ItemTitle>
          {target.label}
          <Badge variant="outline">{humanize(target.status)}</Badge>
          <Badge variant="outline">{humanize(target.channel)}</Badge>
        </ItemTitle>
        <ItemDescription>
          {[target.description, target.destination].filter(Boolean).join(" · ")}
        </ItemDescription>
        {target.holdReason ? (
          <p className="text-amber-700 text-xs dark:text-amber-300">
            Held: {target.holdReason}
          </p>
        ) : null}
      </ItemContent>
      <ItemActions className="ml-auto basis-full justify-end sm:basis-auto">
        {target.sourceUrl ? (
          <Button
            aria-label={`Open source for ${target.label}`}
            nativeButton={false}
            render={
              <a href={target.sourceUrl} rel="noreferrer" target="_blank" />
            }
            size="sm"
            variant="ghost"
          >
            Source <ExternalLink />
          </Button>
        ) : null}
        {mutable && target.status !== "review" ? (
          <Button
            aria-label={`Return ${target.label} to review`}
            disabled={Boolean(busy)}
            onClick={() => void onDecision({ reason: "", status: "review" })}
            size="sm"
            variant="outline"
          >
            <RotateCcw /> Review
          </Button>
        ) : null}
        {mutable && target.status !== "held" ? (
          <HoldTargetDialog
            busy={Boolean(busy)}
            onHold={(reason) => onDecision({ reason, status: "held" })}
            targetLabel={target.label}
          />
        ) : null}
        {mutable && target.status !== "approved" ? (
          <Button
            aria-label={`Approve ${target.label}`}
            disabled={Boolean(busy)}
            id={`approve-campaign-target-${target.id}`}
            onClick={() => void onDecision({ reason: "", status: "approved" })}
            size="sm"
          >
            <Check /> Approve
          </Button>
        ) : null}
      </ItemActions>
    </Item>
  );
}

function HoldTargetDialog({
  busy,
  onHold,
  targetLabel,
}: {
  busy: boolean;
  onHold: (reason: string) => Promise<boolean>;
  targetLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");

  async function submit() {
    if (await onHold(reason.trim())) {
      setOpen(false);
      setReason("");
    }
  }

  return (
    <AlertDialog
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setReason("");
        }
      }}
      open={open}
    >
      <AlertDialogTrigger
        aria-label={`Hold ${targetLabel}`}
        render={<Button size="sm" variant="outline" />}
      >
        <CirclePause /> Hold
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Hold {targetLabel}?</AlertDialogTitle>
          <AlertDialogDescription>
            Record why this target should stay out of execution. You can return
            it to review later.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Textarea
          aria-label="Hold reason"
          onChange={(event) => setReason(event.target.value)}
          placeholder="For example: recipient needs verification"
          value={reason}
        />
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy || reason.trim().length === 0}
            onClick={() => void submit()}
            variant="destructive"
          >
            Hold target
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function isTargetFilter(value: string): value is TargetFilter {
  return targetFilters.includes(value as TargetFilter);
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
