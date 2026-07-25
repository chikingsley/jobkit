import { beforeEach, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { type Database, openDatabase } from "../../src/db/client";
import {
  applicationRoutes,
  jobListings,
  jobMatchFacts,
} from "../../src/db/schema";
import {
  type Candidate,
  rankCandidates,
  readCandidates,
} from "../../src/pipeline/03_match/candidates";

const NOW = "2026-07-25T00:00:00Z";
const BASELINE = readFileSync("migrations/0000_baseline.sql", "utf8");

interface Seed {
  amountMaximum?: number | null;
  amountMinimum?: number | null;
  board: string;
  company?: string;
  country?: string;
  currency?: string | null;
  evidence?: string[];
  id: string;
  period?: string | null;
  routeDestination?: string;
  routeKind?: string | null;
  routeStatus?: string;
  title: string;
}

function factsJson(entry: Seed) {
  return JSON.stringify({
    benefits: [{ value: "housing" }, { value: "airfare" }],
    economics: {
      compensation: {
        amountMaximum: entry.amountMaximum ?? null,
        amountMinimum: entry.amountMinimum ?? null,
        currency: entry.currency ?? null,
        evidence: entry.evidence ?? [],
        period: entry.period ?? null,
      },
      workload: { maximum: 25 },
    },
  });
}

let db: Database;
let schemaVersion: number;

function seed(entries: Seed[]) {
  db.insert(jobListings)
    .values(
      entries.map((entry) => ({
        applyUrl: "https://example.test/apply",
        board: entry.board,
        company: entry.company ?? "Example School",
        country: entry.country ?? "China",
        description: "",
        firstSeenAt: NOW,
        id: entry.id,
        inventoryStatus: "active",
        location: "",
        title: entry.title,
        updatedAt: NOW,
      }))
    )
    .run();
  db.insert(jobMatchFacts)
    .values(
      entries.map((entry) => ({
        factsJson: factsJson(entry),
        jobId: entry.id,
        schemaVersion,
        updatedAt: NOW,
      }))
    )
    .run();
  const routes = entries
    .filter((entry) => entry.routeKind)
    .map((entry) => ({
      createdAt: NOW,
      destination: entry.routeDestination ?? "",
      id: `route-${entry.id}`,
      jobId: entry.id,
      kind: entry.routeKind as string,
      status: entry.routeStatus ?? "active",
      updatedAt: NOW,
    }));
  if (routes.length > 0) {
    db.insert(applicationRoutes).values(routes).run();
  }
}

function byId(candidates: Candidate[], id: string) {
  return candidates.find((candidate) => candidate.listing.id === id);
}

beforeEach(() => {
  const opened = openDatabase(":memory:");
  opened.exec(BASELINE);
  ({ db } = opened);
  const stored = db.all<{ dflt_value: string | null }>(
    sql`SELECT dflt_value FROM pragma_table_info('job_match_facts') WHERE name='schema_version'`
  );
  schemaVersion = Number(stored[0]?.dflt_value ?? 1);
});

describe("reading candidates across every board", () => {
  it("returns platform-apply listings alongside email ones", async () => {
    seed([
      {
        amountMinimum: 18_000,
        board: "anesl",
        currency: "RMB",
        id: "email-job",
        period: "month",
        routeDestination: "jobs@example.test",
        routeKind: "email",
        title: "English Teacher",
      },
      {
        amountMinimum: 100_000,
        board: "seriousteachers",
        country: "Turkey",
        currency: "USD",
        evidence: ["100,000 USD gross annually"],
        id: "form-job",
        period: "year",
        routeKind: "board_form",
        title: "Homeschool Teacher",
      },
      {
        board: "tefl",
        country: "Thailand",
        id: "gated-job",
        routeKind: "login_gated_form",
        title: "IGCSE Physics Teacher",
      },
    ]);
    const candidates = await readCandidates(db);
    expect(
      candidates
        .map((candidate) => candidate.listing.id)
        .sort((first, second) => first.localeCompare(second))
    ).toEqual(["email-job", "form-job", "gated-job"]);
    expect(byId(candidates, "form-job")?.route).toEqual({
      destination: "",
      kind: "board_form",
    });
    expect(byId(candidates, "gated-job")?.route?.kind).toBe("login_gated_form");
    expect(byId(candidates, "email-job")?.route?.destination).toBe(
      "jobs@example.test"
    );
  });

  it("normalises pay on the way out rather than leaving stored values raw", async () => {
    seed([
      {
        amountMinimum: 18_000,
        board: "anesl",
        currency: "RMB",
        id: "rmb-job",
        period: "month",
        routeKind: "email",
        title: "English Teacher",
      },
      {
        amountMaximum: 25_000,
        amountMinimum: 21_000,
        board: "seriousteachers",
        country: "Italy",
        currency: "EUR",
        evidence: ["Salary ranges from 21000 to 25000"],
        id: "unstated-period-job",
        period: null,
        routeKind: "board_form",
        title: "Preschool English Teachers",
      },
      {
        amountMinimum: 27_500,
        board: "seriousteachers",
        country: "Kuwait",
        currency: "USD",
        evidence: ["Annual Salary between 27,500 USD to 47,500 USD"],
        id: "stated-annual-job",
        period: "year",
        routeKind: "board_form",
        title: "Teachers Wanted",
      },
    ]);
    const candidates = await readCandidates(db);
    const rmb = byId(candidates, "rmb-job");
    expect(rmb?.listing.currency).toBe("CNY");
    expect(rmb?.listing.monthlyUsd).toBe(2520);
    const unstated = byId(candidates, "unstated-period-job");
    expect(unstated?.listing.period).toBeNull();
    expect(unstated?.listing.monthlyUsd).toBeNull();
    const stated = byId(candidates, "stated-annual-job");
    expect(stated?.listing.period).toBe("year");
    expect(stated?.listing.monthlyUsd).toBe(2292);
  });

  it("keeps a listing whose pay the board never stated", async () => {
    seed([
      {
        board: "seriousteachers",
        id: "negotiable-job",
        routeKind: "board_form",
        title: "English Teacher Wanted",
      },
    ]);
    const candidates = await readCandidates(db);
    expect(candidates).toHaveLength(1);
    expect(candidates.at(0)?.listing.monthlyUsd).toBeNull();
    const ranked = rankCandidates(candidates);
    expect(ranked).toHaveLength(1);
    expect(ranked.at(0)?.listing.payKnown).toBe(false);
    expect(ranked.at(0)?.route?.kind).toBe("board_form");
  });

  it("restricts to the boards and route kinds the caller asks for", async () => {
    seed([
      {
        board: "anesl",
        id: "email-job",
        routeKind: "email",
        title: "English Teacher",
      },
      {
        board: "seriousteachers",
        id: "form-job",
        routeKind: "board_form",
        title: "Homeschool Teacher",
      },
    ]);
    const onlyForms = await readCandidates(db, { boards: ["seriousteachers"] });
    expect(onlyForms.map((candidate) => candidate.listing.id)).toEqual([
      "form-job",
    ]);
    const onlyEmail = await readCandidates(db, { routeKinds: ["email"] });
    expect(onlyEmail).toHaveLength(2);
    expect(byId(onlyEmail, "form-job")?.route).toBeNull();
  });

  it("ignores a route the board has closed", async () => {
    seed([
      {
        board: "seriousteachers",
        id: "closed-route-job",
        routeKind: "board_form",
        routeStatus: "closed",
        title: "Homeschool Teacher",
      },
    ]);
    const candidates = await readCandidates(db);
    expect(candidates).toHaveLength(1);
    expect(candidates.at(0)?.route).toBeNull();
  });

  it("carries the route through ranking for every listing", async () => {
    seed([
      {
        amountMinimum: 3000,
        board: "anesl",
        company: "High Pay School",
        currency: "USD",
        id: "priced",
        period: "month",
        routeDestination: "jobs@example.test",
        routeKind: "email",
        title: "English Teacher",
      },
      {
        board: "seriousteachers",
        company: "Unstated School",
        id: "unpriced",
        routeKind: "board_form",
        title: "Homeschool Teacher",
      },
    ]);
    const ranked = rankCandidates(await readCandidates(db));
    expect(ranked.map((entry) => entry.listing.id)).toEqual([
      "priced",
      "unpriced",
    ]);
    expect(ranked.map((entry) => entry.route?.kind)).toEqual([
      "email",
      "board_form",
    ]);
  });
});
