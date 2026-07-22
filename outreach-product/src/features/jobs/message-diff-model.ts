import { diffLines } from "diff";

export interface MessageDiffRow {
  afterLine: number | null;
  beforeLine: number | null;
  collapsedCount?: number;
  key: string;
  kind: "added" | "collapsed" | "removed" | "same";
  text: string;
}

interface RawDiffRow extends Omit<MessageDiffRow, "key"> {
  kind: "added" | "removed" | "same";
}

export function messageDiffRows(
  before: string,
  after: string,
  contextLines = 2
): MessageDiffRow[] {
  const rawRows = rawMessageDiffRows(before, after);
  const changedIndexes = rawRows
    .map((row, index) => (row.kind === "same" ? -1 : index))
    .filter((index) => index >= 0);
  if (changedIndexes.length === 0) {
    return [];
  }

  const visible = new Set<number>();
  for (const index of changedIndexes) {
    const start = Math.max(0, index - contextLines);
    const end = Math.min(rawRows.length - 1, index + contextLines);
    for (let cursor = start; cursor <= end; cursor += 1) {
      visible.add(cursor);
    }
  }

  const rows: MessageDiffRow[] = [];
  for (let index = 0; index < rawRows.length; index += 1) {
    const row = rawRows[index];
    if (!row) {
      continue;
    }
    if (row.kind !== "same" || visible.has(index)) {
      rows.push({ ...row, key: `line:${index}:${row.kind}` });
      continue;
    }

    const start = index;
    while (
      index + 1 < rawRows.length &&
      rawRows[index + 1]?.kind === "same" &&
      !visible.has(index + 1)
    ) {
      index += 1;
    }
    const first = rawRows[start];
    if (!first) {
      continue;
    }
    rows.push({
      afterLine: first.afterLine,
      beforeLine: first.beforeLine,
      collapsedCount: index - start + 1,
      key: `collapsed:${start}:${index}`,
      kind: "collapsed",
      text: "",
    });
  }
  return rows;
}

function rawMessageDiffRows(before: string, after: string): RawDiffRow[] {
  let beforeLine = 1;
  let afterLine = 1;
  const rows: RawDiffRow[] = [];
  for (const change of diffLines(before, after)) {
    const kind = changeKind(change);
    for (const text of linesIn(change.value)) {
      rows.push({
        afterLine: kind === "removed" ? null : afterLine,
        beforeLine: kind === "added" ? null : beforeLine,
        kind,
        text,
      });
      if (kind !== "added") {
        beforeLine += 1;
      }
      if (kind !== "removed") {
        afterLine += 1;
      }
    }
  }
  return rows;
}

function changeKind(change: { added?: boolean; removed?: boolean }) {
  if (change.added) {
    return "added" as const;
  }
  if (change.removed) {
    return "removed" as const;
  }
  return "same" as const;
}

function linesIn(value: string) {
  const lines = value.split("\n");
  if (value.endsWith("\n")) {
    lines.pop();
  }
  return lines;
}
