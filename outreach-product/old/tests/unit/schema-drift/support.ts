import type { Database } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { is, type SQL } from "drizzle-orm";
import {
  getTableConfig,
  SQLiteColumn,
  SQLiteSyncDialect,
  SQLiteTable,
} from "drizzle-orm/sqlite-core";
import * as schema from "../../../worker/db/schema";

export interface TableShape {
  columns: Record<
    string,
    { affinity: string; default: string | null; notNull: boolean; pk: number }
  >;
  foreignKeys: string[];
  indexes: Record<
    string,
    { columns: string[]; unique: boolean; where: string | null }
  >;
  uniques: string[];
}

const dialect = new SQLiteSyncDialect();
const WHITESPACE_PATTERN = /\s+/u;
const DESC_PATTERN = /\bdesc\b/iu;
const WHERE_SPLIT_PATTERN = /\bWHERE\b/iu;

function compareText(left: string, right: string): number {
  return left.localeCompare(right);
}

export function applyAllMigrations(database: Database): number {
  const migrationsDir = resolve(import.meta.dir, "../../../migrations");
  const files = readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const name of files) {
    database.exec(readFileSync(join(migrationsDir, name), "utf8"));
  }
  return files.length;
}

export function affinityOf(declaredType: string): string {
  const type = declaredType.toUpperCase();
  if (type.includes("INT")) {
    return "INTEGER";
  }
  if (type.includes("CHAR") || type.includes("CLOB") || type.includes("TEXT")) {
    return "TEXT";
  }
  if (type === "" || type.includes("BLOB")) {
    return "BLOB";
  }
  if (type.includes("REAL") || type.includes("FLOA") || type.includes("DOUB")) {
    return "REAL";
  }
  return "NUMERIC";
}

function normalizeAction(action: string | undefined): string {
  return (action ?? "no action").toUpperCase();
}

function normalizeWhere(text: string): string {
  return text.replace(/\s+/gu, " ").trim().toLowerCase();
}

export function schemaTables(): Map<string, SQLiteTable> {
  const tables = new Map<string, SQLiteTable>();
  for (const value of Object.values(schema)) {
    if (is(value, SQLiteTable)) {
      tables.set(getTableConfig(value).name, value);
    }
  }
  return tables;
}

function renderDefault(value: unknown): string | null {
  if (value === undefined) {
    return null;
  }
  if (typeof value === "string") {
    return `'${value.replaceAll("'", "''")}'`;
  }
  if (typeof value === "boolean") {
    return value ? "1" : "0";
  }
  return String(value);
}

function renderIndexColumn(column: SQLiteColumn | SQL): string {
  if (is(column, SQLiteColumn)) {
    return column.name;
  }
  const rendered = dialect.sqlToQuery(column as SQL).sql;
  const [reference = ""] = rendered.split(WHITESPACE_PATTERN);
  const bare = reference.split(".").at(-1)?.replaceAll('"', "") ?? "";
  return DESC_PATTERN.test(rendered) ? `${bare} DESC` : bare;
}

function expectedColumns(table: SQLiteTable): TableShape["columns"] {
  const config = getTableConfig(table);
  const pkOrder = new Map<string, number>();
  const [composite] = config.primaryKeys;
  if (composite) {
    composite.columns.forEach((column, position) => {
      pkOrder.set(column.name, position + 1);
    });
  }
  const columns: TableShape["columns"] = {};
  for (const column of config.columns) {
    const pk = composite ? (pkOrder.get(column.name) ?? 0) : 0;
    columns[column.name] = {
      affinity: affinityOf(column.getSQLType()),
      default: renderDefault(column.default),
      notNull: column.notNull || column.primary,
      pk: column.primary ? 1 : pk,
    };
  }
  return columns;
}

function expectedForeignKeys(table: SQLiteTable): string[] {
  const config = getTableConfig(table);
  return config.foreignKeys
    .map((foreignKey) => {
      const reference = foreignKey.reference();
      const from = reference.columns.map((column) => column.name).join(",");
      const target = getTableConfig(reference.foreignTable).name;
      const to = reference.foreignColumns
        .map((column) => column.name)
        .join(",");
      const onDelete = normalizeAction(foreignKey.onDelete);
      const onUpdate = normalizeAction(foreignKey.onUpdate);
      return `${from}->${target}(${to}) delete=${onDelete} update=${onUpdate}`;
    })
    .sort(compareText);
}

function expectedIndexes(table: SQLiteTable): TableShape["indexes"] {
  const indexes: TableShape["indexes"] = {};
  for (const index of getTableConfig(table).indexes) {
    const { name, unique, where } = index.config;
    indexes[name ?? ""] = {
      columns: index.config.columns.map((column) =>
        renderIndexColumn(column as SQLiteColumn | SQL)
      ),
      unique,
      where: where ? normalizeWhere(dialect.sqlToQuery(where).sql) : null,
    };
  }
  return indexes;
}

function expectedUniques(table: SQLiteTable): string[] {
  const config = getTableConfig(table);
  const uniques = config.uniqueConstraints.map((constraint) =>
    constraint.columns.map((column) => column.name).join(",")
  );
  for (const column of config.columns) {
    if (column.isUnique) {
      uniques.push(column.name);
    }
  }
  return uniques.sort(compareText);
}

export function expectedShape(table: SQLiteTable): TableShape {
  return {
    columns: expectedColumns(table),
    foreignKeys: expectedForeignKeys(table),
    indexes: expectedIndexes(table),
    uniques: expectedUniques(table),
  };
}

interface TableInfoRow {
  dflt_value: string | null;
  name: string;
  notnull: number;
  pk: number;
  type: string;
}

function actualColumns(
  database: Database,
  tableName: string
): TableShape["columns"] {
  const rows = database
    .query(`PRAGMA table_info("${tableName}")`)
    .all() as TableInfoRow[];
  const columns: TableShape["columns"] = {};
  for (const row of rows) {
    columns[row.name] = {
      affinity: affinityOf(row.type),
      default: row.dflt_value,
      notNull: row.notnull === 1 || row.pk > 0,
      pk: row.pk,
    };
  }
  return columns;
}

interface ForeignKeyRow {
  from: string;
  id: number;
  on_delete: string;
  on_update: string;
  seq: number;
  table: string;
  to: string | null;
}

function actualForeignKeys(database: Database, tableName: string): string[] {
  const rows = database
    .query(`PRAGMA foreign_key_list("${tableName}")`)
    .all() as ForeignKeyRow[];
  const groups = new Map<number, ForeignKeyRow[]>();
  for (const row of rows) {
    const group = groups.get(row.id) ?? [];
    group.push(row);
    groups.set(row.id, group);
  }
  return [...groups.values()]
    .map((group) => {
      const ordered = [...group].sort((a, b) => a.seq - b.seq);
      const first = ordered[0] as ForeignKeyRow;
      const from = ordered.map((row) => row.from).join(",");
      const to = ordered
        .map((row) => {
          if (row.to === null) {
            throw new Error(`implicit FK target in ${tableName}`);
          }
          return row.to;
        })
        .join(",");
      const onDelete = normalizeAction(first.on_delete);
      const onUpdate = normalizeAction(first.on_update);
      return `${from}->${first.table}(${to}) delete=${onDelete} update=${onUpdate}`;
    })
    .sort(compareText);
}

interface IndexListRow {
  name: string;
  origin: string;
  partial: number;
  unique: number;
}
interface IndexXInfoRow {
  desc: number;
  key: number;
  name: string | null;
  seqno: number;
}

function indexColumnsOf(database: Database, indexName: string): string[] {
  const rows = database
    .query(`PRAGMA index_xinfo("${indexName}")`)
    .all() as IndexXInfoRow[];
  return rows
    .filter((row) => row.key === 1)
    .sort((a, b) => a.seqno - b.seqno)
    .map((row) => {
      if (row.name === null) {
        throw new Error(`expression index column in ${indexName}`);
      }
      return row.desc === 1 ? `${row.name} DESC` : row.name;
    });
}

function whereClauseOf(database: Database, indexName: string): string | null {
  const row = database
    .query("SELECT sql FROM sqlite_master WHERE type='index' AND name=?")
    .get(indexName) as { sql: string | null } | null;
  const ddl = row?.sql;
  if (!ddl) {
    return null;
  }
  const parts = ddl.split(WHERE_SPLIT_PATTERN);
  if (parts.length < 2) {
    return null;
  }
  return normalizeWhere(parts.slice(1).join("WHERE"));
}

function actualIndexesAndUniques(
  database: Database,
  tableName: string
): { indexes: TableShape["indexes"]; uniques: string[] } {
  const rows = database
    .query(`PRAGMA index_list("${tableName}")`)
    .all() as IndexListRow[];
  const indexes: TableShape["indexes"] = {};
  const uniques: string[] = [];
  for (const row of rows) {
    if (row.origin === "c") {
      indexes[row.name] = {
        columns: indexColumnsOf(database, row.name),
        unique: row.unique === 1,
        where: row.partial === 1 ? whereClauseOf(database, row.name) : null,
      };
    } else if (row.origin === "u") {
      uniques.push(
        indexColumnsOf(database, row.name)
          .map((column) => column.replace(" DESC", ""))
          .join(",")
      );
    }
  }
  return { indexes, uniques: uniques.sort(compareText) };
}

export function actualShape(database: Database, tableName: string): TableShape {
  const { indexes, uniques } = actualIndexesAndUniques(database, tableName);
  return {
    columns: actualColumns(database, tableName),
    foreignKeys: actualForeignKeys(database, tableName),
    indexes,
    uniques,
  };
}

export function actualTableNames(database: Database): string[] {
  const rows = database
    .query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    )
    .all() as { name: string }[];
  return rows.map((row) => row.name);
}
