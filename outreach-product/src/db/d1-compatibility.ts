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
