import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readSourceInventory } from "../../cli/job-inventory/source";

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
        raw TEXT NOT NULL DEFAULT '',
        raw_json TEXT NOT NULL DEFAULT '{}',
        salary TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'active',
        title TEXT NOT NULL DEFAULT '',
        url TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (board, job_id)
      );
      INSERT INTO jobs (
        board,job_id,title,country,description,url,last_seen_at
      ) VALUES (
        'ajarn','42','English Teacher','Thailand','Teach English',
        'https://example.test/jobs/42','2026-07-21T00:00:00Z'
      );
    `);
    database.close();

    const inventory = readSourceInventory(databasePath);

    expect(inventory).toMatchObject({ active: 1, closed: 0, total: 1 });
    expect(inventory.jobs).toHaveLength(1);
    expect(inventory.jobs[0]).toMatchObject({
      board: "ajarn",
      id: "ajarn:42",
      title: "English Teacher",
    });
  });
});
