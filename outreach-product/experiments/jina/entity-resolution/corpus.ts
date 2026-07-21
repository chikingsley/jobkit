import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { readSourceInventory } from "../../../cli/job-inventory/source";
import type { InventoryJob } from "../../../src/features/inventory/schema";
import {
  domainFromUrl,
  normalizeText,
  stableOrder,
  tokenSet,
} from "../real/text";
import type {
  EntityDocument,
  EntityFacts,
  EntityLinkCase,
  EntityLinkCorpus,
} from "./contracts";

const CORPUS_VERSION = "jobkit-entity-link-calibration-v2";
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
const SOURCE_DOMAINS = new Set([
  "ajarn.com",
  "anesl.com",
  "daveseslcafe.com",
  "eslcafe.com",
  "seriousteachers.com",
  "tefl.com",
]);
const GENERIC_NAMES = new Set([
  "company",
  "confidential",
  "multiple employers",
  "not listed",
  "sponsors",
  "unknown",
]);
const LEGAL_SUFFIX_PATTERN =
  /\b(?:co|company|corp|corporation|inc|ltd|llc|limited|plc)\.?$/giu;
const NON_ALPHANUMERIC_PATTERN = /[^\p{L}\p{N}]+/gu;
const DIACRITIC_PATTERN = /\p{M}+/gu;

interface EntityRoot {
  canonicalName: string;
  contactName: string;
  country: string;
  domain: string;
  id: string;
  jobs: InventoryJob[];
  location: string;
}

export function buildEntityLinkCorpus(input: {
  databasePath?: string;
  size: number;
}): EntityLinkCorpus {
  if (
    !(
      Number.isSafeInteger(input.size) &&
      input.size >= 2 &&
      input.size % 2 === 0
    )
  ) {
    throw new Error(
      "Entity-link corpus size must be an even integer of at least 2"
    );
  }
  const databasePath = resolve(
    input.databasePath ?? "../job-search/job-data/jobs.sqlite"
  );
  const inventory = readSourceInventory(databasePath);
  const roots = buildRoots(inventory.jobs);
  const matches = input.size / 2;
  if (roots.length < matches + 10) {
    throw new Error(
      `Entity-link corpus needs at least ${matches + 10} roots, found ${roots.length}`
    );
  }
  const selected = stableOrder(roots, (root) => `selected:${root.id}`).slice(
    0,
    matches
  );
  const positiveCases = selected.map((root) => positiveCase(root, roots));
  const negativeCases = selected.map((root) => negativeCase(root, roots));
  const cases = stableOrder(
    [...positiveCases, ...negativeCases],
    (testCase) => testCase.id
  );
  validateCorpus(cases, input.size);
  return {
    cases,
    corpusVersion: CORPUS_VERSION,
    createdAt: new Date().toISOString(),
    source: {
      activeJobs: inventory.active,
      corpusKind: "controlled_alias_calibration",
      databasePath,
      entityRoots: roots.length,
    },
  };
}

function buildRoots(jobs: InventoryJob[]) {
  const eligible = jobs.filter((job) => usefulCompany(job.company));
  const parent = eligible.map((_job, index) => index);
  const ownerByStableKey = new Map<string, number>();
  for (const [index, job] of eligible.entries()) {
    const keys = [`name:${normalizeCompany(job.company)}`];
    const domain = jobDomain(job);
    if (domain) {
      keys.push(`domain:${domain}`);
    }
    for (const key of keys) {
      const owner = ownerByStableKey.get(key);
      if (owner === undefined) {
        ownerByStableKey.set(key, index);
      } else {
        unionRoots(parent, index, owner);
      }
    }
  }
  const groups = Map.groupBy(eligible, (_job, index) => find(parent, index));
  return [...groups.values()].flatMap((group) => {
    const canonicalName = mostCommon(group.map((job) => job.company.trim()));
    const country = mostCommon(
      group.map((job) => job.country.trim()).filter(Boolean)
    );
    if (!(canonicalName && country)) {
      return [];
    }
    const domain = mostCommon(group.map(jobDomain).filter(Boolean));
    const identityKey =
      domain || `${normalizeCompany(canonicalName)}|${country}`;
    return [
      {
        canonicalName,
        contactName: mostCommon(
          group.map((job) => job.contactName.trim()).filter(Boolean)
        ),
        country,
        domain,
        id: `entity:${digest(identityKey).slice(0, 20)}`,
        jobs: group,
        location: mostCommon(
          group.map((job) => job.location.trim()).filter(Boolean)
        ),
      } satisfies EntityRoot,
    ];
  });
}

function find(parent: number[], index: number): number {
  let root = index;
  while (parent[root] !== root) {
    root = parent[root] ?? root;
  }
  let current = index;
  while (parent[current] !== root) {
    const next = parent[current] ?? root;
    parent[current] = root;
    current = next;
  }
  return root;
}

function unionRoots(parent: number[], left: number, right: number) {
  const leftRoot = find(parent, left);
  const rightRoot = find(parent, right);
  if (leftRoot !== rightRoot) {
    parent[rightRoot] = leftRoot;
  }
}

function positiveCase(root: EntityRoot, roots: EntityRoot[]): EntityLinkCase {
  const expected = entityDocument(
    root,
    aliasName(root.canonicalName, root.id),
    `${root.id}:alias`,
    "alias"
  );
  const candidates = stableOrder(
    [
      expected,
      ...hardNegatives(root, roots, 9).map((candidate) => ({
        ...entityDocument(
          candidate,
          candidate.canonicalName,
          candidate.id,
          "candidate"
        ),
      })),
    ],
    (candidate) => `positive:${root.id}:${candidate.id}`
  );
  return {
    anchor: {
      ...entityDocument(
        root,
        root.canonicalName,
        `${root.id}:anchor`,
        "anchor"
      ),
    },
    candidates,
    expectedId: expected.id,
    id: `entity-link:match:${root.id}`,
    kind: "match",
    rootId: root.id,
  };
}

function negativeCase(root: EntityRoot, roots: EntityRoot[]): EntityLinkCase {
  const candidates = stableOrder(
    hardNegatives(root, roots, 10).map((candidate) => ({
      ...entityDocument(
        candidate,
        candidate.canonicalName,
        candidate.id,
        "candidate"
      ),
    })),
    (candidate) => `negative:${root.id}:${candidate.id}`
  );
  return {
    anchor: entityDocument(
      root,
      aliasName(root.canonicalName, `${root.id}:negative`),
      `${root.id}:no-match-anchor`,
      "alias"
    ),
    candidates,
    expectedId: null,
    id: `entity-link:no-match:${root.id}`,
    kind: "no_match",
    rootId: root.id,
  };
}

function hardNegatives(root: EntityRoot, roots: EntityRoot[], count: number) {
  return roots
    .filter((candidate) => candidate.id !== root.id)
    .map((candidate) => ({
      candidate,
      score: negativeDifficulty(root, candidate),
      tie: digest(`${root.id}:${candidate.id}`),
    }))
    .toSorted(
      (left, right) =>
        right.score - left.score || left.tie.localeCompare(right.tie)
    )
    .slice(0, count)
    .map((item) => item.candidate);
}

function negativeDifficulty(left: EntityRoot, right: EntityRoot) {
  const leftTokens = tokenSet(left.canonicalName);
  const rightTokens = tokenSet(right.canonicalName);
  const intersection = [...leftTokens].filter((token) =>
    rightTokens.has(token)
  ).length;
  const union = new Set([...leftTokens, ...rightTokens]).size || 1;
  return (
    intersection / union +
    (left.country === right.country ? 0.4 : 0) +
    (left.location &&
    normalizeText(left.location) === normalizeText(right.location)
      ? 0.25
      : 0)
  );
}

function entityCard(
  root: EntityRoot,
  name: string,
  variant: "alias" | "anchor" | "candidate"
) {
  const fields = [`Organization: ${name}`, `Country: ${root.country}`];
  if (root.location) {
    fields.push(`Location: ${root.location}`);
  }
  if (root.contactName && variant !== "anchor") {
    fields.push(`Contact: ${root.contactName}`);
  }
  if (root.domain && variant === "alias") {
    fields.push(`Website domain: ${root.domain}`);
  }
  return fields.join("\n");
}

function entityDocument(
  root: EntityRoot,
  name: string,
  id: string,
  variant: "alias" | "anchor" | "candidate"
): EntityDocument {
  const facts: EntityFacts = {
    contactName: root.contactName,
    country: root.country,
    domain: root.domain,
    location: root.location,
    name,
  };
  return {
    facts,
    id,
    text: entityCard(root, name, variant),
  };
}

function aliasName(value: string, seed: string) {
  const stripped = value
    .normalize("NFKD")
    .replaceAll(DIACRITIC_PATTERN, "")
    .replaceAll("&", " and ")
    .replace(LEGAL_SUFFIX_PATTERN, "")
    .replaceAll(NON_ALPHANUMERIC_PATTERN, " ")
    .replaceAll(/\s+/gu, " ")
    .trim();
  const words = stripped.split(" ").filter(Boolean);
  const selector = Number.parseInt(digest(seed).slice(0, 2), 16) % 3;
  if (selector === 0 && words.length >= 3) {
    return words.map((word) => word[0]?.toLocaleUpperCase("en") ?? "").join("");
  }
  if (selector === 1) {
    return words
      .map((word) => abbreviate(word))
      .join(" ")
      .trim();
  }
  return stripped;
}

function abbreviate(value: string) {
  const abbreviations: Record<string, string> = {
    academy: "Acad",
    center: "Ctr",
    centre: "Ctr",
    college: "Coll",
    education: "Edu",
    international: "Intl",
    language: "Lang",
    school: "Sch",
    university: "Univ",
  };
  return abbreviations[value.toLocaleLowerCase("en")] ?? value;
}

function jobDomain(job: InventoryJob) {
  const applyDomain = domainFromUrl(job.applyUrl);
  if (applyDomain && !SOURCE_DOMAINS.has(applyDomain)) {
    return applyDomain;
  }
  const emailDomain =
    job.applyEmail.split("@").at(-1)?.toLocaleLowerCase("en") ?? "";
  return PERSONAL_EMAIL_DOMAINS.has(emailDomain) ||
    SOURCE_DOMAINS.has(emailDomain)
    ? ""
    : emailDomain;
}

function usefulCompany(value: string) {
  const normalized = normalizeCompany(value);
  return normalized.length >= 4 && !GENERIC_NAMES.has(normalized);
}

function normalizeCompany(value: string) {
  return normalizeText(value)
    .replace(LEGAL_SUFFIX_PATTERN, "")
    .replaceAll(NON_ALPHANUMERIC_PATTERN, " ")
    .replaceAll(/\s+/gu, " ")
    .trim();
}

function mostCommon(values: string[]) {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return (
    [...counts.entries()].toSorted(
      ([leftValue, leftCount], [rightValue, rightCount]) =>
        rightCount - leftCount || leftValue.localeCompare(rightValue)
    )[0]?.[0] ?? ""
  );
}

function validateCorpus(cases: EntityLinkCase[], expectedSize: number) {
  if (cases.length !== expectedSize) {
    throw new Error(
      `Entity-link corpus has ${cases.length}/${expectedSize} cases`
    );
  }
  const ids = new Set(cases.map((testCase) => testCase.id));
  if (ids.size !== cases.length) {
    throw new Error("Entity-link case IDs must be unique");
  }
  for (const testCase of cases) {
    if (testCase.candidates.length !== 10) {
      throw new Error(`${testCase.id} must contain 10 candidates`);
    }
    const containsRoot = testCase.candidates.some((candidate) =>
      candidate.id.startsWith(testCase.rootId)
    );
    if (containsRoot !== (testCase.kind === "match")) {
      throw new Error(`${testCase.id} has an invalid match label`);
    }
  }
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
