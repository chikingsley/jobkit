// The one module that opens a database connection.
//
// `Database` is the exact query surface the application uses. Cloudflare D1
// satisfies it structurally, and `createSqliteDatabase` adapts bun:sqlite to
// it, so the same repository code runs against a local file or a D1 binding.
// Every stage takes a `Database`; nothing else imports a driver.
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

// `first` is an intersection rather than two overload signatures so the shape
// stays a property signature: bare returns the row, with a column name returns
// that column's value.
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

// bun:sqlite rejects undefined and booleans as bound values; D1 accepts both.
// Normalising here keeps call sites identical across the two drivers.
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

  // D1 returns a new bound statement rather than mutating the prepared one.
  bind(...values: unknown[]): BoundStatement {
    return new SqliteStatement(this.#database, this.#sql, values);
  }

  #parameters() {
    return this.#values.map(normalizeValue) as never[];
  }

  // The synchronous core. batch() needs results inside a sqlite transaction,
  // which cannot await, so the promise-returning methods wrap these.
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

  // D1 applies a batch atomically; a local transaction gives the same guarantee.
  // Failures surface as a rejected promise, never a synchronous throw, because
  // callers await this the way they await D1.
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
