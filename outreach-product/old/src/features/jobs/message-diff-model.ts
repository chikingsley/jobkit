import { diffLines, diffWordsWithSpace } from "diff";

const CONNECTED_WORD_CHARACTER = /[\p{L}\p{M}\p{N}_'’]/u;
const WHITESPACE = /\s/u;
const WHITESPACE_ONLY = /^\s*$/u;

export interface MessageHighlightRun {
  highlighted: boolean;
  key: string;
  text: string;
}

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

interface TextRange {
  end: number;
  start: number;
}

export function messageHighlightRuns(
  before: string,
  after: string
): MessageHighlightRun[] {
  if (!before || before === after) {
    return [{ highlighted: false, key: "message:0", text: after }];
  }

  let afterOffset = 0;
  const ranges: TextRange[] = [];
  for (const change of diffWordsWithSpace(before, after)) {
    if (change.added) {
      ranges.push({
        end: afterOffset + change.value.length,
        start: afterOffset,
      });
    }
    if (!change.removed) {
      afterOffset += change.value.length;
    }
  }

  const highlights = mergeHighlightRanges(
    after,
    ranges.map((range) => expandHighlightRange(after, range))
  );
  if (highlights.length === 0) {
    return [{ highlighted: false, key: "message:0", text: after }];
  }

  const runs: MessageHighlightRun[] = [];
  let cursor = 0;
  for (const [index, highlight] of highlights.entries()) {
    if (cursor < highlight.start) {
      runs.push({
        highlighted: false,
        key: `text:${cursor}:${highlight.start}`,
        text: after.slice(cursor, highlight.start),
      });
    }
    runs.push({
      highlighted: true,
      key: `highlight:${index}:${highlight.start}:${highlight.end}`,
      text: after.slice(highlight.start, highlight.end),
    });
    cursor = highlight.end;
  }
  if (cursor < after.length) {
    runs.push({
      highlighted: false,
      key: `text:${cursor}:${after.length}`,
      text: after.slice(cursor),
    });
  }
  return runs;
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

function expandHighlightRange(text: string, range: TextRange): TextRange {
  let { end, start } = range;
  while (start < end && isWhitespace(text[start])) {
    start += 1;
  }
  while (end > start && isWhitespace(text[end - 1])) {
    end -= 1;
  }
  if (
    isConnectedWordCharacter(text[start - 1]) &&
    isConnectedWordCharacter(text[start])
  ) {
    while (start > 0 && isConnectedWordCharacter(text[start - 1])) {
      start -= 1;
    }
  }
  if (
    isConnectedWordCharacter(text[end - 1]) &&
    isConnectedWordCharacter(text[end])
  ) {
    while (end < text.length && isConnectedWordCharacter(text[end])) {
      end += 1;
    }
  }
  return { end, start };
}

function mergeHighlightRanges(text: string, ranges: TextRange[]): TextRange[] {
  const merged: TextRange[] = [];
  for (const range of ranges) {
    if (range.start >= range.end) {
      continue;
    }
    const previous = merged.at(-1);
    if (
      previous &&
      (range.start <= previous.end ||
        WHITESPACE_ONLY.test(text.slice(previous.end, range.start)))
    ) {
      previous.end = Math.max(previous.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

function isConnectedWordCharacter(value: string | undefined) {
  return Boolean(value && CONNECTED_WORD_CHARACTER.test(value));
}

function isWhitespace(value: string | undefined) {
  return Boolean(value && WHITESPACE.test(value));
}
