import type { PrivateJobListQuery } from "../../src/features/jobs/list-query";
import type { JobSort } from "../../src/features/jobs/sorting";
import type { FxData } from "../../src/features/jobs/types";
import { JOB_MATCH_FACTS_SCHEMA_VERSION } from "../../src/pipeline/03_match/version";

export interface JobListPage {
  appliedCount: number;
  countries: string[];
  hasMore: boolean;
  ids: string[];
  nextCursor: string | null;
  totalAvailable: number;
  totalCount: number;
}

interface PageKeyRow {
  hk: number;
  hn: number;
  id: string;
  mk: number;
  mn: number;
  priority: number;
  recency: string;
  status_rank: number;
}

type KeyColumn = keyof PageKeyRow;

const CURSOR_KEY_COLUMNS: KeyColumn[] = [
  "hn",
  "hk",
  "mn",
  "mk",
  "priority",
  "status_rank",
  "recency",
  "id",
];

const SORT_KEY_ORDER: Record<JobSort, [KeyColumn, "ASC" | "DESC"][]> = {
  "match-score": [
    ["priority", "DESC"],
    ["status_rank", "ASC"],
    ["recency", "DESC"],
    ["id", "ASC"],
  ],
  "monthly-pay": [
    ["mn", "ASC"],
    ["mk", "DESC"],
    ["hn", "ASC"],
    ["hk", "DESC"],
    ["priority", "DESC"],
    ["status_rank", "ASC"],
    ["recency", "DESC"],
    ["id", "ASC"],
  ],
  "review-order": [
    ["priority", "DESC"],
    ["status_rank", "ASC"],
    ["recency", "DESC"],
    ["id", "ASC"],
  ],
  "stated-hourly": [
    ["hn", "ASC"],
    ["hk", "DESC"],
    ["mn", "ASC"],
    ["mk", "DESC"],
    ["priority", "DESC"],
    ["status_rank", "ASC"],
    ["recency", "DESC"],
    ["id", "ASC"],
  ],
};

const PUBLIC_JOB_ID_SUBQUERY = `(
  SELECT mapping.public_job_id
  FROM job_source_positions position
  JOIN job_source_position_mapping_heads mapping_head
    ON mapping_head.source_position_id=position.id
  JOIN job_source_position_mapping_versions mapping
    ON mapping.source_position_id=position.id
   AND mapping.version=mapping_head.current_version
  WHERE position.listing_id=j.id
    AND mapping.mapping_state='mapped'
    AND mapping.public_job_id IS NOT NULL
  ORDER BY position.id
  LIMIT 1
)`;

const FACTS_HOURLY_MINIMUM = `CASE
  WHEN f_kind='amount' AND f_currency IS NOT NULL AND f_period IS NOT NULL
   AND (f_min IS NOT NULL OR f_max IS NOT NULL)
  THEN CASE
    WHEN f_period='hour' THEN f_min*1.0
    WHEN w_period IS NULL THEN NULL
    WHEN f_period IN ('contract','day') OR w_period IN ('contract','day')
    THEN CASE WHEN f_period=w_period AND f_min IS NOT NULL
       AND w_max IS NOT NULL THEN f_min*1.0/w_max END
    ELSE CASE WHEN f_min IS NOT NULL AND w_max IS NOT NULL
      THEN (f_min*1.0*CASE f_period WHEN 'week' THEN 52
              WHEN 'fortnight' THEN 26 WHEN 'month' THEN 12 ELSE 1 END)
           /(w_max*CASE w_period WHEN 'week' THEN 52
              WHEN 'fortnight' THEN 26 ELSE 12 END) END
  END
END`;

const FACTS_HOURLY_MAXIMUM = `CASE
  WHEN f_kind='amount' AND f_currency IS NOT NULL AND f_period IS NOT NULL
   AND (f_min IS NOT NULL OR f_max IS NOT NULL)
  THEN CASE
    WHEN f_period='hour' THEN COALESCE(f_max,f_min)*1.0
    WHEN w_period IS NULL THEN NULL
    WHEN f_period IN ('contract','day') OR w_period IN ('contract','day')
    THEN CASE WHEN f_period=w_period AND COALESCE(f_max,f_min) IS NOT NULL
       AND w_min IS NOT NULL THEN COALESCE(f_max,f_min)*1.0/w_min END
    ELSE CASE WHEN COALESCE(f_max,f_min) IS NOT NULL AND w_min IS NOT NULL
      THEN (COALESCE(f_max,f_min)*1.0*CASE f_period WHEN 'week' THEN 52
              WHEN 'fortnight' THEN 26 WHEN 'month' THEN 12 ELSE 1 END)
           /(w_min*CASE w_period WHEN 'week' THEN 52
              WHEN 'fortnight' THEN 26 ELSE 12 END) END
  END
END`;

function rankedCte(scopeSql: string) {
  return `WITH fx_rates(currency,rate) AS (
    SELECT key,CAST(value AS REAL) FROM json_each(?)
  ),
  base AS (
    SELECT j.id,
           COALESCE(uj.priority,0) priority,
           CASE COALESCE(uj.status,'new')
             WHEN 'new' THEN 0 WHEN 'review' THEN 1 WHEN 'approved' THEN 2
             WHEN 'applied' THEN 4 ELSE 3
           END status_rank,
           COALESCE(uj.updated_at,j.updated_at) recency,
           CASE WHEN mf.schema_version=? THEN mf.facts_json END facts_json,
           j.compensation_amount_min row_min,
           j.compensation_amount_max row_max,
           j.compensation_currency row_currency,
           j.compensation_period row_period,
           j.compensation_confidence row_confidence,
           j.compensation_qualifier row_qualifier
      FROM job_listings j
      LEFT JOIN user_listing_states uj ON uj.job_id=j.id AND uj.user_id=?
      LEFT JOIN job_match_facts mf ON mf.job_id=j.id
     WHERE j.inventory_status='active'${scopeSql}
  ),
  econ AS (
    SELECT base.*,
      json_extract(facts_json,'$.economics.compensation.kind') f_kind,
      json_extract(facts_json,'$.economics.compensation.currency') f_currency,
      json_extract(facts_json,'$.economics.compensation.amountMinimum') f_min,
      json_extract(facts_json,'$.economics.compensation.amountMaximum') f_max,
      json_extract(facts_json,'$.economics.compensation.period') f_period,
      json_extract(facts_json,'$.economics.compensation.qualifier') f_qualifier,
      json_extract(facts_json,'$.economics.workload.period') w_period,
      json_extract(facts_json,'$.economics.workload.minimum') w_min,
      json_extract(facts_json,'$.economics.workload.maximum') w_max
    FROM base
  ),
  priced AS (
    SELECT econ.*,ffx.rate f_rate,rfx.rate r_rate,
      ${FACTS_HOURLY_MINIMUM} stated_min,
      ${FACTS_HOURLY_MAXIMUM} stated_max
    FROM econ
    LEFT JOIN fx_rates ffx ON ffx.currency=f_currency
    LEFT JOIN fx_rates rfx ON rfx.currency=row_currency
  ),
  valued AS (
    SELECT priced.*,
      CASE
        WHEN facts_json IS NOT NULL THEN
          CASE WHEN f_rate IS NOT NULL
            THEN COALESCE(stated_min,stated_max)/f_rate END
        WHEN row_period='hour' AND row_currency IS NOT NULL
         AND (row_min IS NOT NULL OR row_max IS NOT NULL)
         AND COALESCE(row_confidence,'')<>'conflict'
         AND r_rate IS NOT NULL
          THEN COALESCE(row_min,row_max)/r_rate
      END hourly_usd,
      CASE
        WHEN facts_json IS NOT NULL THEN
          CASE WHEN f_kind='amount' AND f_min IS NOT NULL
            AND f_currency IS NOT NULL
            AND (f_qualifier IS NULL OR f_qualifier<>'up-to')
            AND f_rate IS NOT NULL
          THEN CASE f_period WHEN 'month' THEN f_min/f_rate
            WHEN 'week' THEN f_min/f_rate*52.0/12.0
            WHEN 'year' THEN f_min/f_rate/12.0 END
          END
        WHEN row_min IS NOT NULL AND row_currency IS NOT NULL
         AND COALESCE(row_confidence,'')<>'conflict'
         AND (row_qualifier IS NULL OR row_qualifier<>'up-to')
         AND r_rate IS NOT NULL
          THEN CASE row_period WHEN 'month' THEN row_min/r_rate
            WHEN 'week' THEN row_min/r_rate*52.0/12.0
            WHEN 'year' THEN row_min/r_rate/12.0 END
      END monthly_usd
    FROM priced
  ),
  keyed AS (
    SELECT id,priority,status_rank,recency,
      CASE WHEN hourly_usd IS NULL THEN 1 ELSE 0 END hn,
      COALESCE(hourly_usd,0) hk,
      CASE WHEN monthly_usd IS NULL THEN 1 ELSE 0 END mn,
      COALESCE(monthly_usd,0) mk
    FROM valued
  )`;
}

interface ListScope {
  parameters: Array<number | string>;
  sql: string;
}

function boardScope(query: PrivateJobListQuery): ListScope {
  if (query.excludeBoard === "") {
    return { parameters: [], sql: "" };
  }
  return {
    parameters: [query.excludeBoard],
    sql: " AND lower(j.board)<>lower(?)",
  };
}

function reviewScope(query: PrivateJobListQuery): ListScope {
  const board = boardScope(query);
  if (query.publicJob) {
    return {
      parameters: [...board.parameters, query.publicJob],
      sql: `${board.sql} AND ${PUBLIC_JOB_ID_SUBQUERY}=?`,
    };
  }
  const country =
    query.country === "all"
      ? { parameters: [] as string[], sql: "" }
      : { parameters: [query.country], sql: " AND j.country=?" };
  return {
    parameters: [...board.parameters, ...country.parameters],
    sql: `${board.sql} AND COALESCE(uj.status,'new')<>'applied'${country.sql}`,
  };
}

export function encodeJobListCursor(sort: JobSort, row: PageKeyRow): string {
  const payload = JSON.stringify({
    k: CURSOR_KEY_COLUMNS.map((column) => row[column]),
    s: sort,
    v: 1,
  });
  const bytes = new TextEncoder().encode(payload);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_");
}

export function decodeJobListCursor(
  raw: string,
  sort: JobSort
): Array<number | string> | null {
  if (raw === "") {
    return null;
  }
  let parsed: unknown;
  try {
    const binary = atob(raw.replaceAll("-", "+").replaceAll("_", "/"));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }
  const cursor = parsed as { k?: unknown; s?: unknown; v?: unknown };
  if (cursor.v !== 1 || cursor.s !== sort || !Array.isArray(cursor.k)) {
    return null;
  }
  const key = cursor.k as Array<number | string>;
  if (key.length !== CURSOR_KEY_COLUMNS.length) {
    return null;
  }
  const numbersValid = key
    .slice(0, 6)
    .every((value) => typeof value === "number" && Number.isFinite(value));
  const textsValid = key
    .slice(6)
    .every((value) => typeof value === "string" && value.length <= 400);
  return numbersValid && textsValid ? key : null;
}

function keysetPredicate(
  sort: JobSort,
  key: Array<number | string>
): { parameters: Array<number | string>; sql: string } {
  const order = SORT_KEY_ORDER[sort];
  const keyValue = (column: KeyColumn) =>
    key[CURSOR_KEY_COLUMNS.indexOf(column)] as number | string;
  const parameters: Array<number | string> = [];
  let sql = "";
  for (let index = order.length - 1; index >= 0; index -= 1) {
    const entry = order[index] as [KeyColumn, "ASC" | "DESC"];
    const [column, direction] = entry;
    const comparator = direction === "ASC" ? ">" : "<";
    if (sql === "") {
      sql = `${column}${comparator}?`;
      parameters.unshift(keyValue(column));
    } else {
      sql = `(${column}${comparator}? OR (${column}=? AND ${sql}))`;
      parameters.unshift(keyValue(column), keyValue(column));
    }
  }
  return { parameters, sql };
}

export async function readJobListPage(
  db: D1Database,
  input: { fx: FxData; query: PrivateJobListQuery; userId: string }
): Promise<JobListPage> {
  const { fx, query, userId } = input;
  const board = boardScope(query);
  const scope = reviewScope(query);
  const cursorKey = decodeJobListCursor(query.cursor, query.sort);
  const orderSql = SORT_KEY_ORDER[query.sort]
    .map(([column, direction]) => `${column} ${direction}`)
    .join(",");
  const fxJson = JSON.stringify(fx.rates);
  const pageParameters: Array<number | string> = [
    fxJson,
    JOB_MATCH_FACTS_SCHEMA_VERSION,
    userId,
    ...scope.parameters,
  ];
  let pageTail: string;
  if (cursorKey) {
    const keyset = keysetPredicate(query.sort, cursorKey);
    pageParameters.push(...keyset.parameters, query.limit + 1);
    pageTail = ` WHERE ${keyset.sql} ORDER BY ${orderSql} LIMIT ?`;
  } else {
    pageParameters.push(query.limit + 1, query.offset);
    pageTail = ` ORDER BY ${orderSql} LIMIT ? OFFSET ?`;
  }
  const results = await db.batch([
    db
      .prepare(
        `${rankedCte(scope.sql)}
         SELECT id,priority,status_rank,recency,hn,hk,mn,mk
           FROM keyed${pageTail}`
      )
      .bind(...pageParameters),
    db
      .prepare(
        `SELECT COUNT(*) total_available,
                COALESCE(SUM(CASE WHEN COALESCE(uj.status,'new')='applied'
                  THEN 1 ELSE 0 END),0) applied_count
           FROM job_listings j
           LEFT JOIN user_listing_states uj
             ON uj.job_id=j.id AND uj.user_id=?
          WHERE j.inventory_status='active'${board.sql}`
      )
      .bind(userId, ...board.parameters),
    db
      .prepare(
        `SELECT COUNT(*) total_count
           FROM job_listings j
           LEFT JOIN user_listing_states uj
             ON uj.job_id=j.id AND uj.user_id=?
          WHERE j.inventory_status='active'${scope.sql}`
      )
      .bind(userId, ...scope.parameters),
    db
      .prepare(
        `SELECT DISTINCT j.country FROM job_listings j
          WHERE j.inventory_status='active'${board.sql}
            AND COALESCE(j.country,'')<>''`
      )
      .bind(...board.parameters),
  ]);
  const [page, counts, totals, countries] = results;
  if (!(page && counts && totals && countries)) {
    throw new Error("The job list query batch was incomplete");
  }
  const pageRows = page.results as unknown as PageKeyRow[];
  const hasMore = pageRows.length > query.limit;
  const visibleRows = hasMore ? pageRows.slice(0, query.limit) : pageRows;
  const lastRow = visibleRows.at(-1);
  const countRow = counts.results[0] as {
    applied_count: number;
    total_available: number;
  };
  const totalRow = totals.results[0] as { total_count: number };
  return {
    appliedCount: Number(countRow.applied_count),
    countries: (countries.results as Array<{ country: string }>)
      .map((row) => row.country)
      .sort((left, right) => left.localeCompare(right)),
    hasMore,
    ids: visibleRows.map((row) => row.id),
    nextCursor:
      hasMore && lastRow ? encodeJobListCursor(query.sort, lastRow) : null,
    totalAvailable: Number(countRow.total_available),
    totalCount: Number(totalRow.total_count),
  };
}
