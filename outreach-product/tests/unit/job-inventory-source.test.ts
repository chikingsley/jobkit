import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readSourceInventory,
  sourceDateEvidence,
} from "../../cli/job-inventory/source";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true }))
  );
});

describe("collector inventory source", () => {
  test("reads the Go collector jobs ledger", async () => {
    const directory = await mkdtemp(join(tmpdir(), "jobkit-inventory-"));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, "jobs.sqlite");
    const database = new Database(databasePath, { create: true, strict: true });
    database.exec(`
      CREATE TABLE jobs (
        apply_email TEXT NOT NULL DEFAULT '',
        apply_url TEXT NOT NULL DEFAULT '',
        board TEXT NOT NULL,
        company TEXT NOT NULL DEFAULT '',
        country TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        job_id TEXT NOT NULL,
        last_seen_at TEXT NOT NULL DEFAULT '',
        location TEXT NOT NULL DEFAULT '',
        posted_date TEXT NOT NULL DEFAULT '',
        raw TEXT NOT NULL DEFAULT '',
        raw_json TEXT NOT NULL DEFAULT '{}',
        salary TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'active',
        title TEXT NOT NULL DEFAULT '',
        url TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (board, job_id)
      );
      INSERT INTO jobs (
        board,job_id,title,country,description,url,last_seen_at,posted_date,
        raw_json
      ) VALUES (
        'ajarn','42','English Teacher','Thailand','Teach English',
        'https://example.test/jobs/42','2026-07-21T00:00:00Z',
        '2026-07-20 08:30',
        json_object('fields',json_object('closing','2026-08-31T23:59'))
      );
      INSERT INTO jobs (
        board,job_id,title,country,description,url,last_seen_at,posted_date,
        raw_json
      ) VALUES (
        'ajarn','43','Relative date job','Thailand','Teach English',
        'https://example.test/jobs/43','2026-07-21T00:00:00Z',
        '2 days ago',
        json_object('fields',json_object('closing','next Friday'))
      );
      INSERT INTO jobs (
        board,job_id,title,country,description,url,last_seen_at
      ) VALUES (
        'ajarn','44','Unknown date job','Thailand','Teach English',
        'https://example.test/jobs/44','2026-07-21T00:00:00Z'
      );
      INSERT INTO jobs (
        board,job_id,title,country,description,url,apply_url,last_seen_at
      ) VALUES (
        'seriousteachers','45','Employer identity job','China','Teach English',
        'https://www.seriousteachers.com/job_details/45/0/0',
        'https://www.seriousteachers.com/te2/respond/45/9876',
        '2026-07-21T00:00:00Z'
      );
    `);
    database.close();

    const inventory = readSourceInventory(databasePath);

    expect(inventory).toMatchObject({ active: 4, closed: 0, total: 4 });
    expect(inventory.jobs).toHaveLength(4);
    expect(inventory.jobs[0]).toMatchObject({
      board: "ajarn",
      id: "ajarn:42",
      sourceDates: {
        expires: {
          date: "2026-08-31",
          provenance: "board-published",
          raw: "2026-08-31T23:59",
        },
        posted: {
          date: "2026-07-20",
          provenance: "board-published",
          raw: "2026-07-20 08:30",
        },
      },
      title: "English Teacher",
    });
    expect(inventory.jobs[1]?.sourceDates).toEqual({
      expires: { date: null, provenance: "unresolved", raw: "next Friday" },
      posted: { date: null, provenance: "unresolved", raw: "2 days ago" },
    });
    expect(inventory.jobs[2]?.sourceDates).toEqual({
      expires: { date: null, provenance: "unknown", raw: "" },
      posted: { date: null, provenance: "unknown", raw: "" },
    });
    expect(inventory.jobs[3]).toMatchObject({
      employerId: "9876",
      id: "45",
    });
  });

  test("keeps invalid calendar dates unresolved", () => {
    expect(sourceDateEvidence("2026-02-30")).toEqual({
      date: null,
      provenance: "unresolved",
      raw: "2026-02-30",
    });
  });
});
