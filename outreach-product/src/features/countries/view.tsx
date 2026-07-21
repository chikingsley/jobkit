import { ArrowRight, Globe2, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import useSWR from "swr";
import { SettingsPage } from "@/components/settings-page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
    <SettingsPage
      description="Review current jobs, build a reusable school catalog, and launch one country at a time."
      title="Countries"
    >
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
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            Loading country markets…
          </CardContent>
        </Card>
      ) : null}
      {!isLoading && markets.length === 0 ? (
        <Card>
          <CardContent className="grid justify-items-center gap-2 py-10 text-center">
            <Globe2 className="size-8 text-muted-foreground" />
            <div className="font-medium">No matching countries</div>
            <div className="text-muted-foreground text-sm">
              Try another name or add a country in Preferences.
            </div>
          </CardContent>
        </Card>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {markets.map((market) => (
          <CountryCard
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

function CountryCard({
  market,
  onOpen,
  preference,
}: {
  market: CountryMarketSummary;
  onOpen: () => void;
  preference: "Acceptable" | "Preferred" | null;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>{market.countryName}</CardTitle>
            <CardDescription>{market.countryCode}</CardDescription>
          </div>
          {preference ? <Badge variant="secondary">{preference}</Badge> : null}
        </div>
      </CardHeader>
      <CardContent className="grid grid-cols-3 gap-3 text-center">
        <Metric label="Open jobs" value={market.openPositionCount} />
        <Metric label="Schools" value={market.organizationCount} />
        <Metric label="Contacts" value={market.verifiedContactCount} />
      </CardContent>
      <div className="px-4">
        <Button className="w-full" onClick={onOpen} variant="outline">
          Open country <ArrowRight />
        </Button>
      </div>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-muted/50 px-2 py-3">
      <div className="font-semibold text-lg">{value}</div>
      <div className="text-muted-foreground text-xs">{label}</div>
    </div>
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
