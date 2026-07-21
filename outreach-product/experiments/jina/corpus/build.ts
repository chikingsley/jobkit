import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { CORPUS_VERSION, type CorpusItem } from "./contracts";
import { createCorpus, openCorpusLedger } from "./ledger";

const BOARDS = [
  "ajarn",
  "anesl",
  "eslcafe-modern",
  "seriousteachers",
  "tefl",
] as const;
const executeFile = promisify(execFile);

const SourceListingSchema = z.object({
  board: z.string().min(1),
  company: z.string(),
  country: z.string(),
  description: z.string().min(1),
  id: z.string().min(1),
  source_url: z.string(),
  title: z.string().min(1),
});

const WranglerResultSchema = z.array(
  z.object({
    results: z.array(SourceListingSchema),
    success: z.literal(true),
  })
);

export async function buildCorpus(input: {
  databasePath: string;
  sampleSize: number;
}) {
  await mkdir(dirname(input.databasePath), { recursive: true });
  const poolPerBoard = Math.ceil(input.sampleSize / BOARDS.length) * 2;
  const sourceListings = await fetchSourceListings(poolPerBoard);
  const items = selectCorpus(sourceListings, input.sampleSize);
  const database = openCorpusLedger(input.databasePath);
  try {
    createCorpus(database, {
      corpusVersion: CORPUS_VERSION,
      items,
      samplingProtocol:
        "active D1 listings; exact normalized-content deduplication; deterministic board and country round-robin sample",
      sourceDatabase: "Cloudflare D1 jobkit-outreach",
    });
  } finally {
    database.close();
  }
  return summarize(items);
}

async function fetchSourceListings(poolPerBoard: number) {
  const sql = `
    WITH exact_groups AS (
      SELECT id, board, title, company, country, description, source_url,
             ROW_NUMBER() OVER (
               PARTITION BY lower(trim(title)), lower(trim(company)),
                            lower(trim(country)), lower(trim(description))
               ORDER BY id DESC
             ) exact_rank
        FROM jobs
       WHERE inventory_status = 'active'
         AND board <> 'jobkit-e2e'
         AND length(trim(title)) > 0
         AND length(trim(description)) > 0
    ), country_diverse AS (
      SELECT id, board, title, company, country, description, source_url,
             ROW_NUMBER() OVER (
               PARTITION BY board, country
               ORDER BY id DESC
             ) country_rank
        FROM exact_groups
       WHERE exact_rank = 1
    ), board_diverse AS (
      SELECT id, board, title, company, country, description, source_url,
             ROW_NUMBER() OVER (
               PARTITION BY board
               ORDER BY country_rank, country, id DESC
             ) board_rank
        FROM country_diverse
    )
    SELECT id, board, title, company, country, description, source_url
      FROM board_diverse
     WHERE board_rank <= ${poolPerBoard}
     ORDER BY board, board_rank
  `;
  const { stdout } = await executeFile(
    "bunx",
    [
      "wrangler",
      "d1",
      "execute",
      "jobkit-outreach",
      "--remote",
      "--command",
      sql,
      "--json",
    ],
    { cwd: process.cwd(), maxBuffer: 16 * 1024 * 1024 }
  );
  const response = WranglerResultSchema.parse(JSON.parse(stdout));
  return response.flatMap((result) => result.results);
}

function selectCorpus(
  sourceListings: z.infer<typeof SourceListingSchema>[],
  sampleSize: number
) {
  const seenHashes = new Set<string>();
  const boardItems = new Map<string, CorpusItem[]>();
  for (const listing of sourceListings) {
    const sourceHash = contentHash(listing);
    if (seenHashes.has(sourceHash)) {
      continue;
    }
    seenHashes.add(sourceHash);
    const items = boardItems.get(listing.board) ?? [];
    items.push({
      board: listing.board,
      company: listing.company,
      country: listing.country,
      description: listing.description,
      duplicateGroup: sourceHash,
      itemId: listing.id,
      sourceHash,
      sourceUrl: listing.source_url,
      title: listing.title,
    });
    boardItems.set(listing.board, items);
  }
  const selected: CorpusItem[] = [];
  for (let offset = 0; selected.length < sampleSize; offset += 1) {
    let added = 0;
    for (const board of BOARDS) {
      const item = boardItems.get(board)?.[offset];
      if (item && selected.length < sampleSize) {
        selected.push(item);
        added += 1;
      }
    }
    if (added === 0) {
      break;
    }
  }
  if (selected.length !== sampleSize) {
    throw new Error(
      `D1 sample produced ${selected.length} unique listings; expected ${sampleSize}`
    );
  }
  return selected;
}

function contentHash(listing: z.infer<typeof SourceListingSchema>) {
  const normalized = [
    listing.title,
    listing.company,
    listing.country,
    listing.description,
  ]
    .join("\n")
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .replaceAll(/<[^>]+>/gu, " ")
    .replaceAll(/\s+/gu, " ")
    .trim();
  return createHash("sha256").update(normalized).digest("hex");
}

function summarize(items: CorpusItem[]) {
  return {
    boards: Object.fromEntries(
      BOARDS.map((board) => [
        board,
        items.filter((item) => item.board === board).length,
      ])
    ),
    corpusVersion: CORPUS_VERSION,
    countries: new Set(items.map((item) => item.country)).size,
    items: items.length,
  };
}
