import { describe, expect, it } from "bun:test";
import { createLocalDatabase } from "../../src/db/create";
import {
  ingestLedgerRows,
  type LedgerRow,
  listingId,
  routeFor,
} from "../../src/pipeline/01_ingest/from-ledger";
import {
  rankCandidates,
  readCandidates,
} from "../../src/pipeline/03_match/candidates";

const NOW = "2026-07-25T00:00:00Z";

function ledgerRow(overrides: Partial<LedgerRow> = {}): LedgerRow {
  return {
    apply_email: "",
    apply_url: "",
    board: "seriousteachers",
    company: "Example School",
    country: "Thailand",
    description: "",
    first_seen_at: NOW,
    job_id: "1",
    last_seen_at: NOW,
    location: "Bangkok",
    raw_json: "{}",
    status: "active",
    title: "English Teacher",
    ...overrides,
  };
}

function seriousTeachersRaw(salary: string) {
  return JSON.stringify({
    fields: {
      "Fields of Expertise": "ESL/EFL, Kindergarten",
      "Required Degrees": "Bachelors Degree",
      Salary: salary,
    },
  });
}

describe("choosing how a listing is applied to", () => {
  it("routes a board that only takes its own form to that form", () => {
    expect(
      routeFor(
        ledgerRow({
          apply_url: "https://www.seriousteachers.com/te2/Login/1/2",
          board: "seriousteachers",
        })
      )
    ).toEqual({
      destination: "https://www.seriousteachers.com/te2/Login/1/2",
      kind: "board_form",
    });
    expect(
      routeFor(ledgerRow({ apply_url: "https://tefl.test/a", board: "tefl" }))
    ).toMatchObject({ kind: "login_gated_form" });
  });

  it("prefers an email address when the board publishes one", () => {
    expect(
      routeFor(
        ledgerRow({
          apply_email: "jobs@school.test",
          apply_url: "https://school.test/apply",
          board: "anesl",
        })
      )
    ).toEqual({ destination: "jobs@school.test", kind: "email" });
  });

  it("falls back to the advert url when there is no email", () => {
    expect(
      routeFor(
        ledgerRow({ apply_url: "https://school.test/x", board: "ajarn" })
      )
    ).toEqual({ destination: "https://school.test/x", kind: "external_url" });
  });

  it("records no route when the board published no way to apply", () => {
    expect(routeFor(ledgerRow({ board: "ajarn" }))).toBeNull();
    expect(routeFor(ledgerRow({ board: "seriousteachers" }))).toBeNull();
  });
});

describe("ingesting the collector ledger into a local database", () => {
  it("carries listings, facts and routes through to a ranked read", async () => {
    const opened = createLocalDatabase(":memory:");
    const report = ingestLedgerRows(opened.db, [
      ledgerRow({
        apply_url: "https://www.seriousteachers.com/te2/Login/1/2",
        job_id: "priced",
        raw_json: seriousTeachersRaw("฿55,000 THB"),
      }),
      ledgerRow({
        apply_url: "https://www.seriousteachers.com/te2/Login/3/4",
        job_id: "unpriced",
        raw_json: seriousTeachersRaw("Negotiable"),
      }),
    ]);
    expect(report.listings).toBe(2);
    expect(report.withFacts).toBe(2);
    expect(report.routes.board_form).toBe(2);

    const ranked = rankCandidates(await readCandidates(opened.db));
    expect(ranked).toHaveLength(2);
    expect(ranked.at(0)?.listing.id).toBe(
      listingId("seriousteachers", "priced")
    );
    expect(ranked.at(0)?.listing.payKnown).toBe(true);
    expect(ranked.at(0)?.route?.kind).toBe("board_form");
    expect(ranked.at(1)?.listing.payKnown).toBe(false);
    opened.close();
  });

  it("keeps a closed listing out of the candidate read", async () => {
    const opened = createLocalDatabase(":memory:");
    ingestLedgerRows(opened.db, [
      ledgerRow({
        apply_url: "https://www.seriousteachers.com/te2/Login/5/6",
        job_id: "closed",
        raw_json: seriousTeachersRaw("฿55,000 THB"),
        status: "closed",
      }),
    ]);
    expect(await readCandidates(opened.db)).toHaveLength(0);
    opened.close();
  });

  it("ingests a board with no extractor as a listing without facts", async () => {
    const opened = createLocalDatabase(":memory:");
    const report = ingestLedgerRows(opened.db, [
      ledgerRow({
        apply_email: "jobs@ajarn.test",
        board: "ajarn",
        job_id: "no-extractor",
      }),
    ]);
    expect(report.listings).toBe(1);
    expect(report.withFacts).toBe(0);
    expect(report.routes.email).toBe(1);
    expect(await readCandidates(opened.db)).toHaveLength(0);
    opened.close();
  });

  it("runs twice over the same ledger without duplicating anything", async () => {
    const opened = createLocalDatabase(":memory:");
    const rows = [
      ledgerRow({
        apply_url: "https://www.seriousteachers.com/te2/Login/7/8",
        job_id: "repeat",
        raw_json: seriousTeachersRaw("฿55,000 THB"),
      }),
    ];
    ingestLedgerRows(opened.db, rows);
    ingestLedgerRows(opened.db, rows);
    expect(await readCandidates(opened.db)).toHaveLength(1);
    opened.close();
  });
});
