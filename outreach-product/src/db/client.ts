import { Database as BunDatabase } from "bun:sqlite";
import { type BunSQLiteDatabase, drizzle } from "drizzle-orm/bun-sqlite";
import { applicationRoutes, jobListings, jobMatchFacts } from "./schema";

const schema = { applicationRoutes, jobListings, jobMatchFacts };

export type Database = BunSQLiteDatabase<typeof schema>;

export interface OpenDatabase {
  close: () => void;
  db: Database;
  exec: (sql: string) => void;
}

export function openDatabase(path: string): OpenDatabase {
  const connection = new BunDatabase(path, { create: true, strict: false });
  connection.exec("PRAGMA journal_mode = WAL");
  connection.exec("PRAGMA foreign_keys = ON");
  return {
    close: () => connection.close(),
    db: drizzle(connection, { schema }),
    exec: (sql: string) => connection.exec(sql),
  };
}
