import { existsSync, rmSync } from "node:fs";
import { createLocalDatabase, LOCAL_DATABASE_PATH } from "../src/db/create";
import {
  ingestLedgerRows,
  periodQuestions,
  readLedger,
} from "../src/pipeline/01_ingest/from-ledger";
import {
  readerFromKeyFile,
  resolvePeriods,
} from "../src/pipeline/02_extract/pay-period";

const LEDGER_PATH = ".jobkit/jobs.sqlite";
const PROGRESS_EVERY = 50;

for (const suffix of ["", "-wal", "-shm"]) {
  const path = `${LOCAL_DATABASE_PATH}${suffix}`;
  if (existsSync(path)) {
    rmSync(path);
  }
}

const rows = readLedger(LEDGER_PATH);
process.stdout.write(`ledger rows: ${rows.length}\n`);

const questions = periodQuestions(rows);
process.stdout.write(`pay periods to read: ${questions.length}\n`);
const periods = await resolvePeriods(
  questions,
  readerFromKeyFile(),
  (done, total) => {
    if (done % PROGRESS_EVERY === 0) {
      process.stdout.write(`  read ${done}/${total}\n`);
    }
  }
);
const byPeriod = new Map<string, number>();
for (const resolution of periods.values()) {
  byPeriod.set(resolution.period, (byPeriod.get(resolution.period) ?? 0) + 1);
}
process.stdout.write(
  `periods resolved: ${periods.size}, unknown ${questions.length - periods.size}\n`
);
for (const [period, count] of [...byPeriod].sort((a, b) => b[1] - a[1])) {
  process.stdout.write(`  ${period.padEnd(8)}${count}\n`);
}

const opened = createLocalDatabase();
const started = Date.now();
const report = ingestLedgerRows(opened.db, rows, periods);
opened.close();

const seconds = ((Date.now() - started) / 1000).toFixed(1);
process.stdout.write(`listings:    ${report.listings}\n`);
process.stdout.write(`with facts:  ${report.withFacts}\n`);
for (const [kind, count] of Object.entries(report.routes)) {
  process.stdout.write(`  ${kind.padEnd(18)}${count}\n`);
}
process.stdout.write(`wrote ${LOCAL_DATABASE_PATH} in ${seconds}s\n`);
