import { execFile } from "node:child_process";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { promisify } from "node:util";
import { SPLIT_VERSION } from "./grouping";

const executeFile = promisify(execFile);

export async function exportFrozenCorpus(input: {
  corpusVersion: string;
  databasePath: string;
  outputPath: string;
}) {
  await mkdir(dirname(input.outputPath), { recursive: true });
  const temporaryPath = `${input.outputPath}.tmp`;
  await rm(temporaryPath, { force: true });
  const sql = `
    INSTALL sqlite;
    LOAD sqlite;
    ATTACH ${sqlString(input.databasePath)} AS corpus (TYPE sqlite, READ_ONLY);
    COPY (
      SELECT i.item_id,i.board,i.title,i.company,i.country,i.description,
             i.source_url,i.source_hash,g.group_id,g.basis,f.label,
             f.provenance,f.notes,s.split
        FROM corpus.corpus_items i
        JOIN corpus.corpus_group_assignments g
          USING(corpus_version,item_id)
        JOIN corpus.corpus_final_labels f
          USING(corpus_version,item_id)
        JOIN corpus.corpus_split_assignments s
          USING(corpus_version,item_id)
       WHERE i.corpus_version=${sqlString(input.corpusVersion)}
         AND s.split_version=${sqlString(SPLIT_VERSION)}
       ORDER BY i.item_id
    ) TO ${sqlString(temporaryPath)} (FORMAT parquet, COMPRESSION zstd);
  `;
  await executeFile("uvx", ["--from", "duckdb-cli", "duckdb", "-c", sql], {
    maxBuffer: 16 * 1024 * 1024,
  });
  await rename(temporaryPath, input.outputPath);
  const metadata = await stat(input.outputPath);
  return {
    bytes: metadata.size,
    corpusVersion: input.corpusVersion,
    outputPath: input.outputPath,
    splitVersion: SPLIT_VERSION,
  };
}

function sqlString(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}
