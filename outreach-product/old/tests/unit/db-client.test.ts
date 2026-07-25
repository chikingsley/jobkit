import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSqliteDatabase } from "../../src/db/client";

const temporaryDirectories: string[] = [];

async function freshDatabase() {
  const directory = await mkdtemp(join(tmpdir(), "jobkit-db-"));
  temporaryDirectories.push(directory);
  const database = createSqliteDatabase(join(directory, "test.sqlite"));
  await database.exec(
    "CREATE TABLE listings (id TEXT PRIMARY KEY, board TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', notes TEXT, active INTEGER NOT NULL DEFAULT 0)"
  );
  return database;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true }))
  );
});

describe("sqlite database client", () => {
  test("round-trips rows through prepare, bind, run and all", async () => {
    const database = await freshDatabase();

    const written = await database
      .prepare("INSERT INTO listings (id,board,title) VALUES (?,?,?)")
      .bind("anesl:1", "anesl", "University Lecturer")
      .run();

    expect(written.success).toBe(true);
    expect(written.meta.changes).toBe(1);

    const read = await database
      .prepare("SELECT id,board,title FROM listings WHERE board=?")
      .bind("anesl")
      .all<{ board: string; id: string; title: string }>();

    expect(read.results).toEqual([
      { board: "anesl", id: "anesl:1", title: "University Lecturer" },
    ]);
    expect(read.meta.rows_read).toBe(1);
  });

  test("first returns a row, a single column, or null", async () => {
    const database = await freshDatabase();
    await database
      .prepare("INSERT INTO listings (id,board,title) VALUES (?,?,?)")
      .bind("ajarn:7", "ajarn", "English Teacher")
      .run();

    const row = await database
      .prepare("SELECT id,board FROM listings WHERE id=?")
      .bind("ajarn:7")
      .first<{ board: string; id: string }>();
    expect(row).toEqual({ board: "ajarn", id: "ajarn:7" });

    const title = await database
      .prepare("SELECT title FROM listings WHERE id=?")
      .bind("ajarn:7")
      .first<string>("title");
    expect(title).toBe("English Teacher");

    const missing = await database
      .prepare("SELECT id FROM listings WHERE id=?")
      .bind("nope")
      .first();
    expect(missing).toBeNull();
  });

  test("bind returns a new statement instead of mutating the prepared one", async () => {
    const database = await freshDatabase();
    const insert = database.prepare(
      "INSERT INTO listings (id,board,title) VALUES (?,?,?)"
    );

    await insert.bind("tefl:1", "tefl", "First").run();
    await insert.bind("tefl:2", "tefl", "Second").run();

    const rows = await database
      .prepare("SELECT id FROM listings ORDER BY id")
      .all<{ id: string }>();
    expect(rows.results.map((entry) => entry.id)).toEqual(["tefl:1", "tefl:2"]);
  });

  test("batch applies every statement atomically and rolls back on failure", async () => {
    const database = await freshDatabase();

    const results = await database.batch([
      database
        .prepare("INSERT INTO listings (id,board) VALUES (?,?)")
        .bind("a", "anesl"),
      database
        .prepare("INSERT INTO listings (id,board) VALUES (?,?)")
        .bind("b", "anesl"),
    ]);
    expect(results).toHaveLength(2);
    expect(results.every((result) => result.success)).toBe(true);

    // The second insert collides on the primary key, so neither row may land.
    await expect(
      database.batch([
        database
          .prepare("INSERT INTO listings (id,board) VALUES (?,?)")
          .bind("c", "anesl"),
        database
          .prepare("INSERT INTO listings (id,board) VALUES (?,?)")
          .bind("a", "anesl"),
      ])
    ).rejects.toThrow();

    const surviving = await database
      .prepare("SELECT id FROM listings ORDER BY id")
      .all<{ id: string }>();
    expect(surviving.results.map((entry) => entry.id)).toEqual(["a", "b"]);
  });

  test("accepts undefined and boolean values the way D1 does", async () => {
    const database = await freshDatabase();

    await database
      .prepare("INSERT INTO listings (id,board,notes,active) VALUES (?,?,?,?)")
      .bind("x", "tefl", undefined, true)
      .run();

    const row = await database
      .prepare("SELECT notes,active FROM listings WHERE id=?")
      .bind("x")
      .first<{ active: number; notes: null | string }>();
    expect(row?.notes).toBeNull();
    expect(row?.active).toBe(1);
  });
});
