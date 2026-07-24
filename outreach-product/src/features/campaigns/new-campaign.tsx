import { useNavigate, useSearch } from "@tanstack/react-router";
import { ArrowLeft, Check, Search } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  useCampaignSetup,
  useCreateCampaign,
} from "@/features/campaigns/queries";
import type { CampaignMarketOption } from "@/features/campaigns/types";
import { cn } from "@/lib/utils";

export function NewCampaignView() {
  const navigate = useNavigate();
  const { country: initialCountry = "" } = useSearch({
    from: "/app/campaigns/new",
  });
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>(
    initialCountry ? [initialCountry] : []
  );
  const [dailyPace, setDailyPace] = useState<number | null>(null);
  const [stopAfter, setStopAfter] = useState<number | null>(null);
  const [postedPercent, setPostedPercent] = useState<number | null>(null);
  const [firstFive, setFirstFive] = useState(true);
  const {
    data: setup,
    error: setupError,
    refetch: retrySetup,
  } = useCampaignSetup();
  const createCampaign = useCreateCampaign();

  if (!setup) {
    return (
      <CampaignSetupStatus
        failed={Boolean(setupError)}
        onRetry={() => void retrySetup()}
      />
    );
  }

  const effectiveDailyPace = dailyPace ?? setup.defaults.dailyPace;
  const effectiveStopAfter = stopAfter ?? setup.defaults.stopAfterHumanReplies;
  const effectivePostedPercent =
    postedPercent ?? setup.defaults.postedTargetPercent;
  const normalizedQuery = query.trim().toLowerCase();
  const markets = setup.markets.filter(
    (market) =>
      !normalizedQuery ||
      market.countryName.toLowerCase().includes(normalizedQuery) ||
      market.countryCode.toLowerCase().includes(normalizedQuery)
  );
  const selectedMarkets = setup.markets.filter((market) =>
    selected.includes(market.countryCode)
  );
  const selectionComplete = selected.length === 3;
  const visibleMarkets = selectionComplete ? selectedMarkets : markets;
  const pool = selectedMarkets.reduce(
    (total, market) =>
      total + market.openPositionCount + market.verifiedContactCount,
    0
  );

  function toggle(countryCode: string) {
    setSelected((current) => {
      if (current.includes(countryCode)) {
        return current.filter((code) => code !== countryCode);
      }
      if (current.length >= 3) {
        toast.error("A campaign can contain up to three countries");
        return current;
      }
      return [...current, countryCode];
    });
  }

  const busy = createCampaign.isPending;

  async function create() {
    if (selected.length === 0) {
      toast.error("Choose at least one country");
      return;
    }
    try {
      const payload = await createCampaign.mutateAsync({
        countryCodes: selected,
        dailyPace: effectiveDailyPace,
        firstFiveRequired: firstFive,
        postedTargetPercent: effectivePostedPercent,
        stopAfterHumanReplies: effectiveStopAfter,
      });
      toast.success(payload.message);
      void navigate({
        params: { campaignId: payload.campaign.id },
        to: "/app/campaigns/$campaignId",
      });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Campaign could not be created"
      );
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-5 sm:px-6">
      <header>
        <Button
          onClick={() => void navigate({ to: "/app/campaigns" })}
          variant="ghost"
        >
          <ArrowLeft /> Campaigns
        </Button>
        <h1 className="mt-3 font-semibold text-2xl tracking-tight">
          Choose target markets
        </h1>
      </header>

      <div className="grid min-h-0 gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card className="self-start">
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle>Target markets</CardTitle>
                <p className="mt-1 text-muted-foreground text-sm">
                  {selectionComplete
                    ? "3 of 3 selected. Remove one to change markets."
                    : `${selected.length} of 3 selected`}
                </p>
              </div>
              {selectionComplete ? null : (
                <div className="relative w-full sm:w-64">
                  <Search className="absolute top-2 left-2.5 size-4 text-muted-foreground" />
                  <Input
                    aria-label="Search countries"
                    className="pl-8"
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search countries"
                    value={query}
                  />
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 md:grid-cols-2">
              {visibleMarkets.map((market) => (
                <MarketChoice
                  checked={selected.includes(market.countryCode)}
                  disabled={
                    selected.length >= 3 &&
                    !selected.includes(market.countryCode)
                  }
                  key={market.countryCode}
                  market={market}
                  onToggle={() => toggle(market.countryCode)}
                />
              ))}
            </div>
            {!selectionComplete && markets.length === 0 ? (
              <p className="py-10 text-center text-muted-foreground text-sm">
                No stored market matches that search. Country discovery can add
                coverage after a market exists in the catalog.
              </p>
            ) : null}
          </CardContent>
        </Card>

        <div className="grid content-start gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Campaign plan</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="campaign-daily-pace">Daily pace</Label>
                <Input
                  id="campaign-daily-pace"
                  min={1}
                  onChange={(event) =>
                    setDailyPace(Number(event.target.value) || 1)
                  }
                  type="number"
                  value={effectiveDailyPace}
                />
                <p className="text-muted-foreground text-xs">
                  Starting pace. Tune it from real delivery and reply data.
                </p>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="campaign-stop-after">
                  Pause after human replies
                </Label>
                <Input
                  id="campaign-stop-after"
                  min={1}
                  onChange={(event) =>
                    setStopAfter(Number(event.target.value) || 1)
                  }
                  type="number"
                  value={effectiveStopAfter}
                />
                <p className="text-muted-foreground text-xs">
                  Person-authored replies count. Bounces, vacation messages, and
                  automated acknowledgements do not.
                </p>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="campaign-posted-percent">
                  Posted-opportunity share
                </Label>
                <Input
                  id="campaign-posted-percent"
                  max={100}
                  min={0}
                  onChange={(event) =>
                    setPostedPercent(Number(event.target.value) || 0)
                  }
                  type="number"
                  value={effectivePostedPercent}
                />
                <p className="text-muted-foreground text-xs">
                  Controls ordering between posted roles and direct school
                  outreach; it does not discard either source.
                </p>
              </div>
              <label
                className="flex items-start justify-between gap-4 rounded-lg border p-3"
                htmlFor="campaign-first-five"
              >
                <span>
                  <span className="block font-medium text-sm">
                    Approve the first five messages
                  </span>
                  <span className="mt-1 block text-muted-foreground text-xs">
                    Review full context and make reusable corrections before the
                    campaign can run.
                  </span>
                </span>
                <Switch
                  checked={firstFive}
                  id="campaign-first-five"
                  onCheckedChange={setFirstFive}
                />
              </label>
              <Button
                className="w-full"
                disabled={busy || selected.length === 0}
                id="create-campaign"
                onClick={() => void create()}
              >
                <Check /> {busy ? "Creating…" : "Create campaign"}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Starting pool</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm">
              <SummaryRow label="Markets" value={selectedMarkets.length} />
              <SummaryRow label="Total opportunities" value={pool} />
              <SummaryRow
                label="Posted jobs"
                value={selectedMarkets.reduce(
                  (total, market) => total + market.openPositionCount,
                  0
                )}
              />
              <SummaryRow
                label="Direct contacts"
                value={selectedMarkets.reduce(
                  (total, market) => total + market.verifiedContactCount,
                  0
                )}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function CampaignSetupStatus({
  failed,
  onRetry,
}: {
  failed: boolean;
  onRetry: () => void;
}) {
  return (
    <div className="mx-auto grid min-h-[28rem] w-full max-w-7xl place-items-center px-4 py-5 sm:px-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>
            {failed
              ? "Campaign setup is unavailable"
              : "Loading campaign setup…"}
          </CardTitle>
        </CardHeader>
        {failed ? (
          <CardContent>
            <Button onClick={onRetry}>Try again</Button>
          </CardContent>
        ) : null}
      </Card>
    </div>
  );
}

function MarketChoice({
  checked,
  disabled,
  market,
  onToggle,
}: {
  checked: boolean;
  disabled: boolean;
  market: CampaignMarketOption;
  onToggle: () => void;
}) {
  const total = market.openPositionCount + market.verifiedContactCount;
  return (
    <label
      className={cn(
        "flex min-w-0 items-start gap-3 rounded-lg border p-3 transition-colors",
        checked && "border-primary bg-primary/5",
        disabled
          ? "cursor-not-allowed opacity-50"
          : "cursor-pointer hover:bg-muted/50"
      )}
      htmlFor={`campaign-market-${market.countryCode}`}
    >
      <Checkbox
        checked={checked}
        disabled={disabled}
        id={`campaign-market-${market.countryCode}`}
        onCheckedChange={onToggle}
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span className="truncate font-medium text-sm">
            {market.countryName}
          </span>
          <Badge variant="secondary">{total.toLocaleString()}</Badge>
        </span>
        <span className="mt-1 block text-muted-foreground text-xs">
          {market.openPositionCount.toLocaleString()} posted ·{" "}
          {market.verifiedContactCount.toLocaleString()} verified contacts ·{" "}
          {market.organizationCount.toLocaleString()} schools cataloged
        </span>
      </span>
    </label>
  );
}

function SummaryRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <strong className="tabular-nums">{value.toLocaleString()}</strong>
    </div>
  );
}
