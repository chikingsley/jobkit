// Keeps the Cloudflare path real rather than merely intended.
//
// A D1 prepared statement satisfies `BoundStatement` structurally, so repository
// code written against this module runs unchanged on D1. `D1Database` itself is
// not assignable to `Database` because its `batch` accepts only D1 statements,
// which is narrower than the interface; `fromD1` bridges exactly that gap.
//
// The type assertion below is the guarantee: if D1 ever changes shape, `tsc`
// fails here instead of at a call site months later.
import type { BoundStatement, Database, QueryResult } from "./client";

type D1StatementSatisfiesBoundStatement =
  D1PreparedStatement extends BoundStatement ? true : never;

export const d1StatementIsCompatible: D1StatementSatisfiesBoundStatement = true;

export function fromD1(database: D1Database): Database {
  return {
    batch: <Row = Record<string, unknown>>(statements: BoundStatement[]) =>
      database.batch(
        statements as unknown as D1PreparedStatement[]
      ) as unknown as Promise<QueryResult<Row>[]>,
    exec: (sql: string) => database.exec(sql),
    prepare: (sql: string) => database.prepare(sql),
  };
}
