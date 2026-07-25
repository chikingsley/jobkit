import { type SQL, sql } from "drizzle-orm";
import { type DrizzleD1Database, drizzle } from "drizzle-orm/d1";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";

export type Db = DrizzleD1Database;

const clients = new WeakMap<D1Database, Db>();

export function getDb(d1: D1Database): Db {
  let client = clients.get(d1);
  if (!client) {
    client = drizzle(d1);
    clients.set(d1, client);
  }
  return client;
}

export function excluded(column: SQLiteColumn): SQL {
  return sql.raw(`excluded.${column.name}`);
}
