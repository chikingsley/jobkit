import { ChevronRight, Globe2, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import useSWR from "swr";
import { SettingsPage } from "@/components/settings-page";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import type { CountryMarketSummary } from "@/features/countries/types";
import { countryOptions } from "@/form-options";
import type { ApiRequest } from "@/lib/api";
import type { Preferences } from "@/profile-types";

export function CountriesView({
  preferences,
  request,
}: {
  preferences: Preferences;
  request: ApiRequest;
}) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const { data, isLoading } = useSWR(
    "/api/countries",
    async (path) =>
      (
        (await (await request(path)).json()) as {
          countries: CountryMarketSummary[];
        }
      ).countries
  );
  const markets = useMemo(() => {
    const byCode = new Map(
      (data ?? []).map((market) => [market.countryCode, market])
    );
    for (const name of [
      ...preferences.countries.preferred,
      ...preferences.countries.acceptable,
    ]) {
      const option = countryOptions.find((country) => country.label === name);
      if (option && !byCode.has(option.code)) {
        byCode.set(option.code, {
          campaignCount: 0,
          countryCode: option.code,
          countryName: option.label,
          latestSweepAt: null,
          latestSweepStatus: null,
          openPositionCount: 0,
          organizationCount: 0,
          verifiedContactCount: 0,
        });
      }
    }
    const normalizedQuery = query.trim().toLowerCase();
    return [...byCode.values()]
      .filter(
        (market) =>
          !normalizedQuery ||
          market.countryName.toLowerCase().includes(normalizedQuery)
      )
      .sort((left, right) => {
        const rank = (name: string) => {
          if (preferences.countries.preferred.includes(name)) {
            return 0;
          }
          if (preferences.countries.acceptable.includes(name)) {
            return 1;
          }
          return 2;
        };
        return (
          rank(left.countryName) - rank(right.countryName) ||
          left.countryName.localeCompare(right.countryName)
        );
      });
  }, [data, preferences, query]);

  return (
    <SettingsPage>
      <div className="relative max-w-md">
        <Search className="absolute top-2 left-2.5 size-4 text-muted-foreground" />
        <Input
          aria-label="Search countries"
          className="pl-8"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search countries"
          value={query}
        />
      </div>
      {isLoading ? (
        <p className="py-10 text-center text-muted-foreground text-sm">
          Loading markets…
        </p>
      ) : null}
      {!isLoading && markets.length === 0 ? (
        <div className="grid justify-items-center gap-2 py-10 text-center">
          <Globe2 className="size-8 text-muted-foreground" />
          <div className="font-medium">No matching markets</div>
          <div className="text-muted-foreground text-sm">
            Try another name or add a country in Preferences.
          </div>
        </div>
      ) : null}
      <div className="grid overflow-hidden rounded-lg border md:grid-cols-2">
        {markets.map((market) => (
          <CountryRow
            key={market.countryCode}
            market={market}
            onOpen={() => navigate(`/campaigns/markets/${market.countryCode}`)}
            preference={countryPreference(market.countryName, preferences)}
          />
        ))}
      </div>
    </SettingsPage>
  );
}

function CountryRow({
  market,
  onOpen,
  preference,
}: {
  market: CountryMarketSummary;
  onOpen: () => void;
  preference: "Acceptable" | "Preferred" | null;
}) {
  return (
    <button
      className="flex min-h-24 items-center gap-4 border-b p-4 text-left transition-colors hover:bg-muted/50 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:border-r"
      onClick={onOpen}
      type="button"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">{market.countryName}</span>
          {preference ? <Badge variant="secondary">{preference}</Badge> : null}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground text-xs">
          <Metric label="jobs" value={market.openPositionCount} />
          <Metric label="schools" value={market.organizationCount} />
          <Metric label="contacts" value={market.verifiedContactCount} />
        </div>
      </div>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </button>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <span>
      <strong className="font-medium text-foreground tabular-nums">
        {value}
      </strong>{" "}
      {label}
    </span>
  );
}

function countryPreference(country: string, preferences: Preferences) {
  if (preferences.countries.preferred.includes(country)) {
    return "Preferred" as const;
  }
  if (preferences.countries.acceptable.includes(country)) {
    return "Acceptable" as const;
  }
  return null;
}
