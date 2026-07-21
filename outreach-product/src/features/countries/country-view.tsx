import { ArrowLeft, ChevronRight, ExternalLink, RefreshCw } from "lucide-react";
import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { toast } from "sonner";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type {
  CountryCampaignReference,
  CountryDetail,
  CountryOpportunitySummary,
  CountryOrganizationSummary,
  CountrySweepSummary,
} from "@/features/countries/types";
import type { ApiRequest } from "@/lib/api";

export function CountryView({ request }: { request: ApiRequest }) {
  const { countryCode = "" } = useParams();
  const navigate = useNavigate();
  const [cityInput, setCityInput] = useState("");
  const { data, isLoading, mutate } = useSWR(
    countryCode ? `/api/countries/${countryCode}` : null,
    async (path) =>
      ((await (await request(path)).json()) as { country: CountryDetail })
        .country
  );

  async function refresh() {
    const cities = [
      ...new Set(
        cityInput
          .split(",")
          .map((city) => city.trim())
          .filter(Boolean)
      ),
    ];
    try {
      const response = await request(`/api/countries/${countryCode}/sweeps`, {
        body: JSON.stringify({
          cities,
          includeDirectories: true,
          includeKnownSources: true,
          includeMaps: true,
          includeSearch: true,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const result = (await response.json()) as { message?: string };
      await mutate();
      toast.success(result.message ?? "Country refresh queued");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Country refresh failed"
      );
    }
  }

  if (isLoading || !data) {
    return (
      <SettingsPage
        description="Loading jobs, schools, and campaign activity."
        title="Country"
      >
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            Loading country…
          </CardContent>
        </Card>
      </SettingsPage>
    );
  }

  return (
    <SettingsPage
      description="Open positions and direct school outreach stay separate while sharing one campaign policy."
      title={data.countryName}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button onClick={() => navigate("/campaigns/markets")} variant="ghost">
          <ArrowLeft /> Countries
        </Button>
        <div className="flex gap-2">
          <Input
            aria-label="Optional city focus"
            className="w-64"
            onChange={(event) => setCityInput(event.target.value)}
            placeholder="City focus (optional)"
            value={cityInput}
          />
          <Button onClick={() => void refresh()} variant="outline">
            <RefreshCw />
            {cityInput.trim() ? "Refresh city" : "Refresh country"}
          </Button>
          <Button
            onClick={() =>
              navigate(`/campaigns/new?country=${data.countryCode}`)
            }
          >
            Start campaign
          </Button>
        </div>
      </div>
      <Tabs defaultValue="positions">
        <TabsList variant="line">
          <TabsTrigger value="positions">
            Open positions ({data.opportunities.length})
          </TabsTrigger>
          <TabsTrigger value="schools">
            Schools ({data.organizations.length})
          </TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>
        <TabsContent className="grid gap-3 pt-3" value="positions">
          {data.opportunities.length > 0 ? (
            data.opportunities.map((opportunity) => (
              <OpportunityCard key={opportunity.id} opportunity={opportunity} />
            ))
          ) : (
            <EmptyCard message="No open positions are currently stored for this country." />
          )}
        </TabsContent>
        <TabsContent className="grid gap-3 pt-3" value="schools">
          {data.organizations.length > 0 ? (
            data.organizations.map((organization) => (
              <OrganizationCard
                key={organization.id}
                organization={organization}
              />
            ))
          ) : (
            <EmptyCard message="Run a country refresh to build the school and contact catalog." />
          )}
        </TabsContent>
        <TabsContent className="grid gap-4 pt-3" value="activity">
          <ActivitySection campaigns={data.campaigns} sweeps={data.sweeps} />
        </TabsContent>
      </Tabs>
    </SettingsPage>
  );
}

function OpportunityCard({
  opportunity,
}: {
  opportunity: CountryOpportunitySummary;
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>{opportunity.title}</CardTitle>
            <CardDescription>
              {opportunity.company} · {opportunity.location}
            </CardDescription>
          </div>
          <Badge variant="outline">{opportunity.board}</Badge>
        </div>
      </CardHeader>
      <CardContent className="flex items-center justify-between gap-3">
        <span className="text-muted-foreground text-xs">
          {opportunity.userStatus ?? "Not reviewed"}
        </span>
        <Button
          nativeButton={false}
          render={
            <a href={opportunity.sourceUrl} rel="noreferrer" target="_blank" />
          }
          size="sm"
          variant="ghost"
        >
          Source <ExternalLink />
        </Button>
      </CardContent>
    </Card>
  );
}

function OrganizationCard({
  organization,
}: {
  organization: CountryOrganizationSummary;
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>{organization.name}</CardTitle>
            <CardDescription>
              {organization.city || "Location unverified"} ·{" "}
              {organization.marketSegment.replaceAll("_", " ")}
            </CardDescription>
            {organization.roleSummary ? (
              <p className="mt-1 text-muted-foreground text-sm">
                {organization.roleSummary}
              </p>
            ) : null}
          </div>
          <Badge
            variant={
              organization.outreachEligibility === "eligible"
                ? "secondary"
                : "outline"
            }
          >
            {organization.outreachEligibility}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex items-center justify-between gap-3">
        <div className="text-muted-foreground text-xs">
          <span>
            {organization.contactCount} verified direct contact
            {organization.contactCount === 1 ? "" : "s"}
          </span>
          {organization.evidenceCount > 0 ? (
            <span>
              {" "}
              · {organization.evidenceCount} research record
              {organization.evidenceCount === 1 ? "" : "s"}
              {organization.latestEvidenceStatus
                ? ` · ${organization.latestEvidenceStatus}`
                : ""}
            </span>
          ) : null}
        </div>
        {organization.websiteUrl ? (
          <Button
            nativeButton={false}
            render={
              <a
                href={organization.websiteUrl}
                rel="noreferrer"
                target="_blank"
              />
            }
            size="sm"
            variant="ghost"
          >
            Website <ExternalLink />
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ActivitySection({
  campaigns,
  sweeps,
}: {
  campaigns: CountryCampaignReference[];
  sweeps: CountrySweepSummary[];
}) {
  const navigate = useNavigate();
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Campaigns</CardTitle>
          <CardDescription>
            Saved target sets and execution mode.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {campaigns.length > 0 ? (
            campaigns.map((campaign) => (
              <div className="rounded-lg border p-3" key={campaign.id}>
                <div className="flex justify-between gap-3">
                  <span className="font-medium">{campaign.name}</span>
                  <Badge variant="outline">{campaign.status}</Badge>
                </div>
                <div className="mt-1 text-muted-foreground text-sm">
                  {campaign.targetCount} target
                  {campaign.targetCount === 1 ? "" : "s"} ·{" "}
                  {formatDate(campaign.createdAt)}
                </div>
                {campaign.targetCount > 0 ? (
                  <Button
                    className="mt-2"
                    onClick={() => navigate(`/campaigns/${campaign.id}`)}
                    size="sm"
                    variant="outline"
                  >
                    Open campaign <ChevronRight />
                  </Button>
                ) : null}
              </div>
            ))
          ) : (
            <div className="text-muted-foreground text-sm">
              No campaigns yet.
            </div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Country refreshes</CardTitle>
          <CardDescription>
            Discovery, verification, and coverage audit.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {sweeps.length > 0 ? (
            sweeps.map((sweep) => (
              <div className="rounded-lg border p-3" key={sweep.id}>
                <div className="flex justify-between gap-3">
                  <span className="font-medium">
                    {formatDate(sweep.requestedAt)}
                  </span>
                  <Badge variant="outline">{sweep.status}</Badge>
                </div>
                <div className="mt-1 text-muted-foreground text-sm">
                  {sweep.cities.length > 0
                    ? `City focus: ${sweep.cities.join(", ")} · `
                    : "Country-wide · "}
                  {Object.entries(sweep.taskCounts)
                    .map(([status, count]) => `${count} ${status}`)
                    .join(" · ") || "Preparing tasks"}
                </div>
              </div>
            ))
          ) : (
            <div className="text-muted-foreground text-sm">
              No refreshes yet.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function EmptyCard({ message }: { message: string }) {
  return (
    <Card>
      <CardContent className="py-10 text-center text-muted-foreground">
        {message}
      </CardContent>
    </Card>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
