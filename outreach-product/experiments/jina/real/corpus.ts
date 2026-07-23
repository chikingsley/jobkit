import { resolve } from "node:path";
import { readSourceInventory } from "../../../cli/job-inventory/source";
import type { InventoryJob } from "../../../src/features/inventory/schema";
import type {
  DeduplicationCase,
  RankingCase,
  ReaderCase,
  RealCapabilityCorpus,
  RealJobDocument,
  SearchCase,
} from "./contracts";
import { domainFromUrl, stableOrder } from "./text";

const CORPUS_VERSION = "jobkit-jina-real-capabilities-v1";
const PERSONAL_EMAIL_DOMAINS = new Set([
  "126.com",
  "163.com",
  "gmail.com",
  "hotmail.com",
  "naver.com",
  "outlook.com",
  "rocketmail.com",
  "yahoo.com",
  "yeah.net",
]);

export function buildRealCapabilityCorpus(input: {
  databasePath?: string;
  size: number;
}): RealCapabilityCorpus {
  const databasePath = resolve(
    input.databasePath ?? "../job-search/job-data/jobs.sqlite"
  );
  const inventory = readSourceInventory(databasePath);
  return {
    corpusVersion: CORPUS_VERSION,
    createdAt: new Date().toISOString(),
    deduplication: buildDeduplicationCases(inventory.jobs, input.size),
    reader: buildReaderCases(inventory.jobs, input.size),
    reranking: buildRankingCases(inventory.jobs, input.size),
    search: buildSearchCases(inventory.jobs, input.size),
    source: { activeJobs: inventory.active, databasePath },
  };
}

function buildReaderCases(jobs: InventoryJob[], size: number): ReaderCase[] {
  const byBoard = Map.groupBy(
    jobs.filter((job) => job.sourceUrl && job.description),
    (job) => job.board
  );
  const boards = [...byBoard.keys()].toSorted();
  const baseQuota = Math.floor(size / boards.length);
  let remainder = size % boards.length;
  return boards.flatMap((board) => {
    const quota = baseQuota + (remainder > 0 ? 1 : 0);
    remainder -= 1;
    return stableOrder(byBoard.get(board) ?? [], readerKey)
      .slice(0, quota)
      .map((job) => ({
        board,
        description: job.description,
        id: `reader:${job.id}`,
        markers: readerMarkers(job),
        url: job.sourceUrl,
      }));
  });
}

function buildSearchCases(jobs: InventoryJob[], size: number): SearchCase[] {
  const domainCounts = new Map<string, number>();
  const cases: SearchCase[] = [];
  for (const job of stableOrder(jobs, (item) => `search:${item.id}`)) {
    const expectedDomain = destinationDomain(job);
    if (!(expectedDomain && usefulCompany(job.company))) {
      continue;
    }
    const used = domainCounts.get(expectedDomain) ?? 0;
    if (used >= 3) {
      continue;
    }
    domainCounts.set(expectedDomain, used + 1);
    cases.push({
      expectedDomain,
      id: `search:${job.id}`,
      query: [
        job.company,
        job.location,
        job.country,
        "official website teaching jobs",
      ]
        .filter(Boolean)
        .join(" "),
      sourceJobId: job.id,
    });
    if (cases.length === size) {
      break;
    }
  }
  return cases;
}

function buildRankingCases(jobs: InventoryJob[], size: number): RankingCase[] {
  const countryCounts = new Map<string, number>();
  for (const job of jobs) {
    countryCounts.set(job.country, (countryCounts.get(job.country) ?? 0) + 1);
  }
  const eligibleTargets = stableOrder(
    jobs.filter(
      (job) =>
        job.country &&
        job.location &&
        usefulTitle(job.title) &&
        (countryCounts.get(job.country) ?? 0) >= 10
    ),
    (job) => `ranking:${job.id}`
  );
  return eligibleTargets.slice(0, size).map((target) => {
    const sameCountry = jobs.filter(
      (job) => job.country === target.country && job.id !== target.id
    );
    const distractors = stableOrder(
      sameCountry,
      (job) => `${target.id}:${job.id}`
    ).slice(0, 9);
    return {
      documents: stableOrder(
        [target, ...distractors].map(jobDocument),
        (document) => `documents:${target.id}:${document.id}`
      ),
      expectedId: target.id,
      id: `reranking:${target.id}`,
      query: [target.title, target.location, target.country, target.salary]
        .filter(Boolean)
        .join(" · "),
    };
  });
}

function buildDeduplicationCases(
  jobs: InventoryJob[],
  size: number
): DeduplicationCase[] {
  const byRecipient = Map.groupBy(
    jobs.filter((job) => job.applyEmail),
    (job) => job.applyEmail.toLocaleLowerCase("en")
  );
  const groups = stableOrder(
    [...byRecipient.entries()].filter(([, group]) => group.length >= 2),
    ([email]) => `recipient:${email}`
  );
  const cases: DeduplicationCase[] = [];
  for (let round = 0; cases.length < size; round += 1) {
    let added = false;
    for (const group of groups) {
      const deduplicationCase = createDeduplicationCase(jobs, group, round);
      if (!deduplicationCase) {
        continue;
      }
      cases.push(deduplicationCase);
      added = true;
      if (cases.length === size) {
        return cases;
      }
    }
    if (!added || round > 10) {
      break;
    }
  }
  return cases;
}

function createDeduplicationCase(
  jobs: InventoryJob[],
  [email, group]: [string, InventoryJob[]],
  round: number
): DeduplicationCase | null {
  const ordered = stableOrder(group, (job) => `${email}:${job.id}`);
  const anchor = ordered[round % ordered.length];
  const expected = ordered[(round + 1) % ordered.length];
  if (!(anchor && expected) || anchor.id === expected.id) {
    return null;
  }
  const distractors = stableOrder(
    jobs.filter(
      (job) =>
        job.id !== anchor.id &&
        job.applyEmail.toLocaleLowerCase("en") !== email &&
        (job.country === anchor.country || job.board === anchor.board)
    ),
    (job) => `${anchor.id}:${job.id}`
  ).slice(0, 9);
  if (distractors.length < 9) {
    return null;
  }
  return {
    anchor: identityDocument(anchor),
    candidates: stableOrder(
      [expected, ...distractors].map(identityDocument),
      (document) => `identity:${anchor.id}:${document.id}`
    ),
    expectedId: expected.id,
    id: `deduplication:${anchor.id}:${expected.id}`,
  };
}

function readerMarkers(job: InventoryJob) {
  return [
    ["title", usefulTitle(job.title) ? job.title : ""],
    ["company", usefulCompany(job.company) ? job.company : ""],
    ["location", job.location],
    ["salary", job.salary],
    ["applyEmail", job.applyEmail],
  ]
    .filter((entry): entry is [string, string] => Boolean(entry[1]?.trim()))
    .map(([field, value]) => ({ field, value }));
}

function destinationDomain(job: InventoryJob) {
  const applyDomain = domainFromUrl(job.applyUrl);
  if (applyDomain && job.applyUrl !== job.sourceUrl) {
    return applyDomain;
  }
  const emailDomain =
    job.applyEmail.split("@").at(-1)?.toLocaleLowerCase("en") ?? "";
  return PERSONAL_EMAIL_DOMAINS.has(emailDomain) ? "" : emailDomain;
}

function usefulTitle(value: string) {
  const normalized = value.trim().toLocaleLowerCase("en");
  return Boolean(
    normalized && normalized !== "sponsors" && normalized !== "job"
  );
}

function usefulCompany(value: string) {
  const normalized = value.trim().toLocaleLowerCase("en");
  return Boolean(
    normalized && normalized !== "sponsors" && normalized !== "unknown"
  );
}

function readerKey(job: InventoryJob) {
  return `reader:${job.board}:${job.id}`;
}

function jobDocument(job: InventoryJob): RealJobDocument {
  return {
    id: job.id,
    text: [
      job.title,
      job.company,
      job.location,
      job.country,
      job.salary,
      job.description.slice(0, 3000),
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

function identityDocument(job: InventoryJob): RealJobDocument {
  return {
    id: job.id,
    text: [
      job.contactName,
      job.company,
      job.title,
      job.location,
      job.country,
      job.description.slice(0, 1200),
    ]
      .filter(Boolean)
      .join("\n"),
  };
}
