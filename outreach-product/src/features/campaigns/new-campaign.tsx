import { ArrowLeft, Check, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type {
  CampaignDetail,
  CampaignMarketOption,
  CampaignSetup,
} from "@/features/campaigns/types";
import type { ApiRequest } from "@/lib/api";
import { cn } from "@/lib/utils";

export function NewCampaignView({ request }: { request: ApiRequest }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialCountry = (searchParams.get("country") ?? "").toUpperCase();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>(
    initialCountry ? [initialCountry] : []
  );
  const [dailyPace, setDailyPace] = useState<number | null>(null);
  const [stopAfter, setStopAfter] = useState<number | null>(null);
  const [postedPercent, setPostedPercent] = useState<number | null>(null);
  const [firstFive, setFirstFive] = useState(true);
  const [busy, setBusy] = useState(false);
  const { data: setup } = useSWR("/api/campaigns/setup", async (path) => {
    const payload = (await (await request(path)).json()) as {
      setup: CampaignSetup;
    };
    return payload.setup;
  });

  const effectiveDailyPace = dailyPace ?? setup?.defaults.dailyPace ?? 1;
  const effectiveStopAfter =
    stopAfter ?? setup?.defaults.stopAfterHumanReplies ?? 3;
  const effectivePostedPercent =
    postedPercent ?? setup?.defaults.postedTargetPercent ?? 80;
  const markets = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return (setup?.markets ?? []).filter(
      (market) =>
        !normalized ||
        market.countryName.toLowerCase().includes(normalized) ||
        market.countryCode.toLowerCase().includes(normalized)
    );
  }, [query, setup?.markets]);
  const selectedMarkets = (setup?.markets ?? []).filter((market) =>
    selected.includes(market.countryCode)
  );
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

  async function create() {
    if (selected.length === 0) {
      toast.error("Choose at least one country");
      return;
    }
    setBusy(true);
    try {
      const response = await request("/api/campaigns", {
        body: JSON.stringify({
          countryCodes: selected,
          dailyPace: effectiveDailyPace,
          firstFiveRequired: firstFive,
          postedTargetPercent: effectivePostedPercent,
          stopAfterHumanReplies: effectiveStopAfter,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const payload = (await response.json()) as {
        campaign: CampaignDetail;
        message: string;
      };
      toast.success(payload.message);
      navigate(`/campaigns/${payload.campaign.id}`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Campaign could not be created"
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-5 sm:px-6">
      <header>
        <Button onClick={() => navigate("/campaigns")} variant="ghost">
          <ArrowLeft /> Campaigns
        </Button>
        <div className="mt-3">
          <p className="font-medium text-muted-foreground text-xs uppercase tracking-wider">
            New campaign
          </p>
          <h1 className="mt-1 font-semibold text-2xl tracking-tight">
            Choose target markets
          </h1>
          <p className="mt-1 max-w-2xl text-muted-foreground text-sm leading-6">
            Select up to three countries with one coherent goal. JobKit admits
            the full eligible pool; pace controls how quickly it moves, not how
            much of the pool exists.
          </p>
        </div>
      </header>

      <div className="grid min-h-0 gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle>Target markets</CardTitle>
                <CardDescription>
                  {selected.length} of 3 selected
                </CardDescription>
              </div>
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
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 md:grid-cols-2">
              {markets.map((market) => (
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
            {setup && markets.length === 0 ? (
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
              <CardDescription>
                Every value remains visible and editable before launch.
              </CardDescription>
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
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Starting pool</CardTitle>
              <CardDescription>
                Based on inventory currently stored in JobKit.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm">
              <SummaryRow label="Markets" value={selectedMarkets.length} />
              <SummaryRow label="Known candidates" value={pool} />
              <SummaryRow
                label="Advertised"
                value={selectedMarkets.reduce(
                  (total, market) => total + market.openPositionCount,
                  0
                )}
              />
              <SummaryRow
                label="Verified school contacts"
                value={selectedMarkets.reduce(
                  (total, market) => total + market.verifiedContactCount,
                  0
                )}
              />
              <Button
                className="mt-2 w-full"
                disabled={busy || selected.length === 0}
                onClick={() => void create()}
              >
                <Check /> {busy ? "Creating…" : "Create campaign"}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
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
