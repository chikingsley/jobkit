import { Database as BunDatabase } from "bun:sqlite";

export interface QueryMeta {
  changes: number;
  last_row_id: number;
  rows_read: number;
  rows_written: number;
}

export interface QueryResult<Row = Record<string, unknown>> {
  meta: QueryMeta;
  results: Row[];
  success: boolean;
}

export interface BoundStatement {
  all: <Row = Record<string, unknown>>() => Promise<QueryResult<Row>>;
  bind: (...values: unknown[]) => BoundStatement;
  first: (<Row = Record<string, unknown>>() => Promise<Row | null>) &
    (<Value = unknown>(column: string) => Promise<Value | null>);
  raw: <Row = unknown[]>() => Promise<Row[]>;
  run: <Row = Record<string, unknown>>() => Promise<QueryResult<Row>>;
}

export interface Database {
  batch: <Row = Record<string, unknown>>(
    statements: BoundStatement[]
  ) => Promise<QueryResult<Row>[]>;
  exec: (sql: string) => Promise<unknown>;
  prepare: (sql: string) => BoundStatement;
}

function emptyMeta(): QueryMeta {
  return { changes: 0, last_row_id: 0, rows_read: 0, rows_written: 0 };
}

function normalizeValue(value: unknown) {
  if (value === undefined) {
    return null;
  }
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }
  return value as null | number | string;
}

class SqliteStatement implements BoundStatement {
  readonly #database: BunDatabase;
  readonly #sql: string;
  readonly #values: unknown[];

  constructor(database: BunDatabase, sql: string, values: unknown[] = []) {
    this.#database = database;
    this.#sql = sql;
    this.#values = values;
  }

  bind(...values: unknown[]): BoundStatement {
    return new SqliteStatement(this.#database, this.#sql, values);
  }

  #parameters() {
    return this.#values.map(normalizeValue) as never[];
  }

  allSync<Row = Record<string, unknown>>(): QueryResult<Row> {
    const results = this.#database
      .prepare(this.#sql)
      .all(...this.#parameters()) as unknown as Row[];
    return {
      meta: { ...emptyMeta(), rows_read: results.length },
      results,
      success: true,
    };
  }

  runSync<Row = Record<string, unknown>>(): QueryResult<Row> {
    const changes = this.#database
      .prepare(this.#sql)
      .run(...this.#parameters());
    return {
      meta: {
        ...emptyMeta(),
        changes: Number(changes.changes ?? 0),
        last_row_id: Number(changes.lastInsertRowid ?? 0),
        rows_written: Number(changes.changes ?? 0),
      },
      results: [] as Row[],
      success: true,
    };
  }

  all<Row = Record<string, unknown>>(): Promise<QueryResult<Row>> {
    return Promise.resolve(this.allSync<Row>());
  }

  run<Row = Record<string, unknown>>(): Promise<QueryResult<Row>> {
    return Promise.resolve(this.runSync<Row>());
  }

  first<Row = Record<string, unknown>>(): Promise<Row | null>;
  first<Value = unknown>(column: string): Promise<Value | null>;
  first(column?: string): Promise<unknown> {
    const row = this.#database
      .prepare(this.#sql)
      .get(...this.#parameters()) as Record<string, unknown> | null;
    if (row === null || row === undefined) {
      return Promise.resolve(null);
    }
    return Promise.resolve(column === undefined ? row : (row[column] ?? null));
  }

  raw<Row = unknown[]>(): Promise<Row[]> {
    return Promise.resolve(
      this.#database
        .prepare(this.#sql)
        .values(...this.#parameters()) as unknown as Row[]
    );
  }
}

class SqliteDatabase implements Database {
  readonly #database: BunDatabase;

  constructor(database: BunDatabase) {
    this.#database = database;
  }

  prepare(sql: string): BoundStatement {
    return new SqliteStatement(this.#database, sql);
  }

  exec(sql: string): Promise<unknown> {
    this.#database.exec(sql);
    return Promise.resolve({ count: 0, duration: 0 });
  }

  // biome-ignore lint/suspicious/useAwait: the transaction is synchronous; async makes throws reject.
  async batch<Row = Record<string, unknown>>(
    statements: BoundStatement[]
  ): Promise<QueryResult<Row>[]> {
    for (const statement of statements) {
      if (!(statement instanceof SqliteStatement)) {
        throw new TypeError(
          "batch() accepts only statements prepared by this database"
        );
      }
    }
    const prepared = statements as SqliteStatement[];
    const apply = this.#database.transaction(() =>
      prepared.map((statement) => statement.runSync<Row>())
    );
    return apply();
  }

  close() {
    this.#database.close();
  }
}

export function createSqliteDatabase(path: string) {
  const database = new BunDatabase(path, { create: true, strict: false });
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA foreign_keys = ON");
  return new SqliteDatabase(database);
}
