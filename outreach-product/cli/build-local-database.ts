import { existsSync, rmSync } from "node:fs";
import { createLocalDatabase, LOCAL_DATABASE_PATH } from "../src/db/create";
import {
  ingestLedgerRows,
  readLedger,
} from "../src/pipeline/01_ingest/from-ledger";

const LEDGER_PATH = ".jobkit/jobs.sqlite";

for (const suffix of ["", "-wal", "-shm"]) {
  const path = `${LOCAL_DATABASE_PATH}${suffix}`;
  if (existsSync(path)) {
    rmSync(path);
  }
}

const rows = readLedger(LEDGER_PATH);
process.stdout.write(`ledger rows: ${rows.length}\n`);

const opened = createLocalDatabase();
const started = Date.now();
const report = ingestLedgerRows(opened.db, rows);
opened.close();

const seconds = ((Date.now() - started) / 1000).toFixed(1);
process.stdout.write(`listings:    ${report.listings}\n`);
process.stdout.write(`with facts:  ${report.withFacts}\n`);
for (const [kind, count] of Object.entries(report.routes)) {
  process.stdout.write(`  ${kind.padEnd(18)}${count}\n`);
}
process.stdout.write(`wrote ${LOCAL_DATABASE_PATH} in ${seconds}s\n`);
