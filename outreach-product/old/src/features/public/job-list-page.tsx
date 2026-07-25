import { Link } from "@tanstack/react-router";
import { ArrowRight, Banknote, BriefcaseBusiness, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import type {
  PublicJobListItem,
  PublicJobListResponse,
} from "../../../worker/public-jobs/schemas";
import {
  publicJobCompensation,
  publicJobEmployment,
  publicJobHourlyUsd,
  publicJobLocation,
  publicJobPosted,
} from "./job-format";
import {
  PublicPageHeading,
  PublicPageMain,
  PublicSiteShell,
} from "./site-shell";

export function PublicJobListPage({
  basePath,
  response,
}: {
  basePath: string;
  response: PublicJobListResponse;
}) {
  const title = scopeTitle(response);
  return (
    <PublicSiteShell>
      <PublicPageMain>
        <PublicPageHeading
          description={`${response.items.length.toLocaleString()} opportunities in this view`}
          title={title}
        />
        <PublicJobSearchForm response={response} />
        <section aria-label="Job results" className="mt-8">
          {response.items.length === 0 ? (
            <div className="border-y py-12 text-center">
              <h2 className="font-semibold">
                No published jobs match this view
              </h2>
              <p className="mt-1 text-muted-foreground text-sm">
                Change the search or filters to widen the results.
              </p>
            </div>
          ) : (
            <ul className="divide-y border-y">
              {response.items.map((job) => (
                <PublicJobResult job={job} key={job.publicId} />
              ))}
            </ul>
          )}
          {response.page.nextCursor ? (
            <div className="mt-6 flex justify-center">
              <Button
                render={
                  <a
                    href={pageHref(
                      basePath,
                      response,
                      response.page.nextCursor
                    )}
                  />
                }
                size="lg"
                variant="outline"
              >
                More jobs <ArrowRight />
              </Button>
            </div>
          ) : null}
        </section>
      </PublicPageMain>
    </PublicSiteShell>
  );
}

export function PublicJobListErrorPage({
  basePath,
  stale,
}: {
  basePath: string;
  stale: boolean;
}) {
  return (
    <PublicSiteShell>
      <PublicPageMain className="grid min-h-[calc(100svh-8rem)] content-center">
        <h1 className="font-semibold text-3xl tracking-tight">
          {stale ? "The job catalog changed" : "This job search is invalid"}
        </h1>
        <p className="mt-2 max-w-xl text-muted-foreground leading-7">
          {stale
            ? "Restart this view from the current catalog to continue browsing."
            : "Open the job catalog with a shorter search and current filters."}
        </p>
        <Button className="mt-6 w-fit" render={<a href={basePath} />} size="lg">
          Open current jobs
        </Button>
      </PublicPageMain>
    </PublicSiteShell>
  );
}

function PublicJobSearchForm({
  response,
}: {
  response: PublicJobListResponse;
}) {
  return (
    <form className="mt-7 grid gap-3 border-y py-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      <label className="grid gap-1.5 sm:col-span-2 xl:col-span-1">
        <span className="font-medium text-xs">Search</span>
        <input
          className="h-10 rounded-lg border bg-background px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 lg:text-sm"
          defaultValue={response.query.q ?? ""}
          name="q"
          placeholder="Title, school, or location"
          type="search"
        />
      </label>
      {response.scope.kind === "global" ? (
        <label className="grid gap-1.5">
          <span className="font-medium text-xs">Country code</span>
          <input
            className="h-10 rounded-lg border bg-background px-3 text-base uppercase outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 lg:text-sm"
            defaultValue={response.query.country ?? ""}
            maxLength={2}
            name="country"
            placeholder="PL"
          />
        </label>
      ) : null}
      <SelectFilter
        defaultValue={response.query.workplace ?? ""}
        label="Workplace"
        name="workplace"
        options={[
          ["", "Any"],
          ["onsite", "On-site"],
          ["hybrid", "Hybrid"],
          ["remote", "Remote"],
        ]}
      />
      <SelectFilter
        defaultValue={response.query.employmentType ?? ""}
        label="Employment"
        name="employmentType"
        options={[
          ["", "Any"],
          ["fullTime", "Full-time"],
          ["partTime", "Part-time"],
          ["contract", "Contract"],
        ]}
      />
      <SelectFilter
        defaultValue={response.query.compensation ?? ""}
        label="Compensation"
        name="compensation"
        options={[
          ["", "Any"],
          ["stated", "Stated"],
          ["negotiable", "Negotiable"],
        ]}
      />
      <SelectFilter
        defaultValue={response.query.sort}
        label="Sort"
        name="sort"
        options={[
          ["recent", "Recent"],
          ["relevance", "Relevance"],
          ["hourlyUsd", "Hourly USD"],
          ["title", "Title"],
        ]}
      />
      <div className="flex items-end">
        <Button className="h-10 w-full px-4 lg:w-auto" type="submit">
          Search
        </Button>
      </div>
    </form>
  );
}

function SelectFilter({
  defaultValue,
  label,
  name,
  options,
}: {
  defaultValue: string;
  label: string;
  name: string;
  options: Array<readonly [string, string]>;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="font-medium text-xs">{label}</span>
      <select
        className="h-10 rounded-lg border bg-background px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 lg:text-sm"
        defaultValue={defaultValue}
        name={name}
      >
        {options.map(([value, option]) => (
          <option key={value || "any"} value={value}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function PublicJobResult({ job }: { job: PublicJobListItem }) {
  const posted = publicJobPosted(job);
  const hourly = publicJobHourlyUsd(job);
  return (
    <li>
      <Link
        className="group grid min-h-28 gap-4 px-1 py-5 outline-none hover:bg-muted/40 focus-visible:bg-muted/40 sm:grid-cols-[minmax(0,1fr)_minmax(16rem,0.65fr)] sm:px-3"
        params={{ publicId: job.publicId, slug: job.canonicalSlug }}
        to="/job/$publicId/$slug"
      >
        <div className="min-w-0">
          <h2 className="text-balance font-semibold text-lg leading-6 group-hover:underline">
            {job.title}
          </h2>
          <p className="mt-1 text-muted-foreground text-sm">
            {job.organization.name}
          </p>
          <p className="mt-3 flex items-start gap-2 text-sm">
            <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <span>{publicJobLocation(job)}</span>
          </p>
        </div>
        <div className="grid content-start gap-2 text-sm">
          <Fact icon={Banknote} value={publicJobCompensation(job)} />
          {hourly ? <Fact icon={Banknote} value={hourly} /> : null}
          <Fact icon={BriefcaseBusiness} value={publicJobEmployment(job)} />
          {posted ? (
            <div className="text-muted-foreground text-xs sm:text-right">
              Posted {posted}
            </div>
          ) : null}
        </div>
      </Link>
    </li>
  );
}

function Fact({ icon: Icon, value }: { icon: typeof Banknote; value: string }) {
  return (
    <div className="flex items-start gap-2 sm:justify-end sm:text-right">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <span>{value}</span>
    </div>
  );
}

function scopeTitle(response: PublicJobListResponse) {
  if (response.scope.kind === "city") {
    return `Teaching jobs in ${response.scope.displayName}`;
  }
  if (response.scope.kind === "country") {
    const region = new Intl.DisplayNames(["en"], { type: "region" }).of(
      response.scope.countryCode
    );
    return `Teaching jobs in ${region ?? response.scope.countryCode}`;
  }
  return "Teaching jobs";
}

function pageHref(
  basePath: string,
  response: PublicJobListResponse,
  cursor: string
) {
  const parameters = new URLSearchParams();
  set(parameters, "q", response.query.q);
  set(parameters, "country", response.query.country);
  set(parameters, "workplace", response.query.workplace);
  set(parameters, "employmentType", response.query.employmentType);
  set(parameters, "compensation", response.query.compensation);
  parameters.set("sort", response.query.sort);
  parameters.set("limit", String(response.query.limit));
  parameters.set("cursor", cursor);
  return `${basePath}?${parameters.toString()}`;
}

function set(parameters: URLSearchParams, key: string, value: string | null) {
  if (value !== null) {
    parameters.set(key, value);
  }
}
