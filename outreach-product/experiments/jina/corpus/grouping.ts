import { createHash } from "node:crypto";
import type {
  CorpusFinalLabel,
  CorpusGroupAssignment,
  CorpusItem,
  CorpusSplitAssignment,
} from "./contracts";

const SHINGLE_SIZE = 5;
const MIN_SHARED_SHINGLES = 100;
const MIN_TEMPLATE_CONTAINMENT = 0.7;
export const HELD_OUT_FRACTION = 0.2;
export const SPLIT_VERSION = "grouped-sha256-20pct-v1";

interface GroupEdge {
  basis: "exact-source" | "five-token-template-overlap" | "same-company";
  left: number;
  right: number;
}

export function assignLeakageGroups(items: CorpusItem[]) {
  const unionFind = new UnionFind(items.length);
  const edges: GroupEdge[] = [];
  const addEdge = (edge: GroupEdge) => {
    unionFind.union(edge.left, edge.right);
    edges.push(edge);
  };
  connectMatchingValues(
    items.map((item) => item.sourceHash),
    "exact-source",
    addEdge
  );
  connectMatchingValues(
    items.map((item) => normalizeCompany(item.company)),
    "same-company",
    addEdge
  );
  connectTemplateOverlaps(items, addEdge);
  return groupAssignments(items, unionFind, edges);
}

function connectTemplateOverlaps(
  items: CorpusItem[],
  addEdge: (edge: GroupEdge) => void
) {
  const shingleSets = items.map((item) =>
    shingles(`${item.title}\n${item.description}`)
  );
  for (let left = 0; left < items.length; left += 1) {
    for (let right = left + 1; right < items.length; right += 1) {
      const similarity = templateSimilarity(
        shingleSets[left] ?? new Set(),
        shingleSets[right] ?? new Set()
      );
      if (
        similarity.shared >= MIN_SHARED_SHINGLES &&
        similarity.containment >= MIN_TEMPLATE_CONTAINMENT
      ) {
        addEdge({ basis: "five-token-template-overlap", left, right });
      }
    }
  }
}

function groupAssignments(
  items: CorpusItem[],
  unionFind: UnionFind,
  edges: GroupEdge[]
) {
  const membersByRoot = new Map<number, number[]>();
  for (let index = 0; index < items.length; index += 1) {
    const root = unionFind.find(index);
    membersByRoot.set(root, [...(membersByRoot.get(root) ?? []), index]);
  }
  const assignments: CorpusGroupAssignment[] = [];
  for (const [root, memberIndexes] of membersByRoot) {
    const itemIds = memberIndexes.map(
      (index) => requiredItem(items, index).itemId
    );
    const groupId = createHash("sha256")
      .update(itemIds.toSorted().join("\n"))
      .digest("hex");
    const bases = new Set(
      edges
        .filter((edge) => unionFind.find(edge.left) === root)
        .map((edge) => edge.basis)
    );
    const basis =
      bases.size === 0 ? "singleton" : [...bases].toSorted().join(",");
    for (const index of memberIndexes) {
      assignments.push({
        basis,
        groupId,
        itemId: requiredItem(items, index).itemId,
      });
    }
  }
  return assignments.toSorted((left, right) =>
    left.itemId.localeCompare(right.itemId)
  );
}

export function assignGroupedSplits(
  groups: CorpusGroupAssignment[],
  finalLabels: CorpusFinalLabel[],
  corpusVersion: string
) {
  const membersByGroup = new Map<string, string[]>();
  for (const group of groups) {
    membersByGroup.set(group.groupId, [
      ...(membersByGroup.get(group.groupId) ?? []),
      group.itemId,
    ]);
  }
  const assignments: CorpusSplitAssignment[] = [];
  for (const [groupId, itemIds] of membersByGroup) {
    const split =
      stableFraction(`${corpusVersion}\n${SPLIT_VERSION}\n${groupId}`) <
      HELD_OUT_FRACTION
        ? "held_out"
        : "train";
    for (const itemId of itemIds) {
      assignments.push({ itemId, split });
    }
  }
  validateSplitCoverage(assignments, finalLabels);
  return assignments.toSorted((left, right) =>
    left.itemId.localeCompare(right.itemId)
  );
}

export function groupingProtocol() {
  return {
    companyRule: "same non-empty normalized company",
    heldOutFraction: HELD_OUT_FRACTION,
    shingleSize: SHINGLE_SIZE,
    splitVersion: SPLIT_VERSION,
    templateRule: {
      minimumContainment: MIN_TEMPLATE_CONTAINMENT,
      minimumSharedShingles: MIN_SHARED_SHINGLES,
    },
  };
}

function connectMatchingValues(
  values: string[],
  basis: GroupEdge["basis"],
  addEdge: (edge: GroupEdge) => void
) {
  const firstByValue = new Map<string, number>();
  for (const [index, value] of values.entries()) {
    if (!value) {
      continue;
    }
    const first = firstByValue.get(value);
    if (first === undefined) {
      firstByValue.set(value, index);
    } else {
      addEdge({ basis, left: first, right: index });
    }
  }
}

function normalizeCompany(value: string) {
  return normalizeText(value);
}

function shingles(value: string) {
  const words = normalizeText(value).split(" ").filter(Boolean);
  const values = new Set<string>();
  for (let index = 0; index + SHINGLE_SIZE <= words.length; index += 1) {
    values.add(words.slice(index, index + SHINGLE_SIZE).join(" "));
  }
  return values;
}

function templateSimilarity(left: Set<string>, right: Set<string>) {
  const smaller = left.size <= right.size ? left : right;
  const larger = left.size <= right.size ? right : left;
  let shared = 0;
  for (const value of smaller) {
    if (larger.has(value)) {
      shared += 1;
    }
  }
  return {
    containment: shared / Math.max(1, smaller.size),
    shared,
  };
}

function normalizeText(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .replaceAll(/<[^>]+>/gu, " ")
    .replaceAll(/[^\p{L}\p{N}]+/gu, " ")
    .replaceAll(/\s+/gu, " ")
    .trim();
}

function stableFraction(value: string) {
  const hash = createHash("sha256").update(value).digest();
  return hash.readUInt32BE(0) / 2 ** 32;
}

function validateSplitCoverage(
  assignments: CorpusSplitAssignment[],
  finalLabels: CorpusFinalLabel[]
) {
  const labels = new Map(
    finalLabels.map((label) => [label.itemId, label.label])
  );
  const seen = new Map<string, Set<string>>();
  for (const assignment of assignments) {
    const label = labels.get(assignment.itemId);
    if (!label) {
      throw new Error(`Split item ${assignment.itemId} has no final label`);
    }
    const splits = seen.get(label) ?? new Set<string>();
    splits.add(assignment.split);
    seen.set(label, splits);
  }
  for (const [label, splits] of seen) {
    if (!(splits.has("train") && splits.has("held_out"))) {
      throw new Error(`Label ${label} is missing from one corpus split`);
    }
  }
}

function requiredItem(items: CorpusItem[], index: number) {
  const item = items[index];
  if (!item) {
    throw new Error(`Missing corpus item at index ${index}`);
  }
  return item;
}

class UnionFind {
  private readonly parent: number[];

  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, index) => index);
  }

  find(index: number): number {
    const parent = this.parent[index];
    if (parent === undefined) {
      throw new Error(`Unknown union-find index ${index}`);
    }
    if (parent === index) {
      return index;
    }
    const root = this.find(parent);
    this.parent[index] = root;
    return root;
  }

  union(left: number, right: number) {
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);
    if (leftRoot === rightRoot) {
      return;
    }
    this.parent[Math.max(leftRoot, rightRoot)] = Math.min(leftRoot, rightRoot);
  }
}
