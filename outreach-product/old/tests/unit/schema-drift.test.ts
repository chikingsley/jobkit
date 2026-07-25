import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  actualShape,
  actualTableNames,
  applyAllMigrations,
  expectedShape,
  schemaTables,
} from "./schema-drift/support";

describe("drizzle schema drift guard", () => {
  const database = new Database(":memory:", { strict: true });
  const tables = schemaTables();
  let applied = 0;

  beforeAll(() => {
    applied = applyAllMigrations(database);
  });

  afterAll(() => {
    database.close();
  });

  test("drizzle schema covers exactly the tables the migrations create", () => {
    expect(applied).toBeGreaterThanOrEqual(72);
    const byName = (left: string, right: string) => left.localeCompare(right);
    const actual = actualTableNames(database).sort(byName);
    const expected = [...tables.keys()].sort(byName);
    expect(expected).toEqual(actual);
  });

  test("every table matches the migrated database shape", () => {
    for (const [tableName, table] of tables) {
      const expected = expectedShape(table);
      const actual = actualShape(database, tableName);
      if (JSON.stringify(expected) !== JSON.stringify(actual)) {
        expect({ shape: expected, table: tableName }).toEqual({
          shape: actual,
          table: tableName,
        });
      }
    }
    expect(tables.size).toBeGreaterThan(0);
  });
});
