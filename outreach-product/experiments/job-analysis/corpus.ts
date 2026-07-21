import { Database } from "bun:sqlite";
import { resolve } from "node:path";
import type { AnalysisCase } from "./contracts";

const CORPUS_PATH = resolve(
  import.meta.dir,
  "../jina/corpus/jobkit-jina-real-listings-v1.sqlite"
);

export function readAnalysisCases(count: number): AnalysisCase[] {
  const database = new Database(CORPUS_PATH, { readonly: true });
  try {
    const rows = database
      .query<Omit<AnalysisCase, "salary">, [number]>(`WITH ranked AS (
          SELECT item_id id,board,title,company,country,description,source_url sourceUrl,
                 ROW_NUMBER() OVER (
                   PARTITION BY board
                   ORDER BY length(description) DESC,item_id
                 ) board_rank
            FROM corpus_items
        )
        SELECT id,board,title,company,country,description,sourceUrl
          FROM ranked
         ORDER BY board_rank,board,id
         LIMIT ?`)
      .all(count);
    return rows.map((row) => ({ ...row, salary: "" }));
  } finally {
    database.close();
  }
}
