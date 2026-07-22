import { describe, expect, it } from "bun:test";
import { messageDiffRows } from "../../src/features/jobs/message-diff-model";

describe("messageDiffRows", () => {
  it("collapses distant unchanged lines and keeps context around an edit", () => {
    const before = Array.from(
      { length: 12 },
      (_, index) => `line ${index + 1}`
    ).join("\n");
    const after = before.replace("line 7", "updated line 7");

    const rows = messageDiffRows(before, after, 1);

    expect(rows.map((row) => row.kind)).toEqual([
      "collapsed",
      "same",
      "removed",
      "added",
      "same",
      "collapsed",
    ]);
    expect(rows[0]?.collapsedCount).toBe(5);
    expect(rows.at(-1)?.collapsedCount).toBe(4);
  });

  it("tracks old and new line numbers for additions and removals", () => {
    const rows = messageDiffRows(
      "Hello\nOld sentence\nBest",
      "Hello\nNew sentence\nBest"
    );
    const removed = rows.find((row) => row.kind === "removed");
    const added = rows.find((row) => row.kind === "added");

    expect(removed).toMatchObject({ afterLine: null, beforeLine: 2 });
    expect(added).toMatchObject({ afterLine: 2, beforeLine: null });
  });

  it("returns an empty collection for identical messages", () => {
    expect(messageDiffRows("Same message", "Same message")).toEqual([]);
  });
});
