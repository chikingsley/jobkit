"""Repository checks for generated TEFL course artifacts."""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass
from typing import TYPE_CHECKING

from tefl_course.paths import PROJECT_ROOT

if TYPE_CHECKING:
    from pathlib import Path

_DOUBLED_OPTION_RE = re.compile(
    r"^(?P<prefix>[ \t]+)(?P<label>[a-d])\.\s+(?P<dup>[A-D])(?P<mark>[.)])\s+",
    re.MULTILINE,
)


@dataclass(frozen=True)
class OptionLabelIssue:
    """One doubled option label such as `a. A.`."""

    path: Path
    line: int
    text: str


def find_doubled_option_labels(text: str, path: Path) -> list[OptionLabelIssue]:
    """Return every doubled option-label issue in `text`."""
    issues: list[OptionLabelIssue] = []
    for match in _DOUBLED_OPTION_RE.finditer(text):
        if match.group("label").lower() != match.group("dup").lower():
            continue
        line_no = text.count("\n", 0, match.start()) + 1
        line = text.splitlines()[line_no - 1].strip()
        issues.append(OptionLabelIssue(path=path, line=line_no, text=line))
    return issues


def normalize_doubled_option_labels(text: str) -> str:
    """Collapse doubled option labels, preserving the first markdown label."""

    def replace(match: re.Match[str]) -> str:
        if match.group("label").lower() != match.group("dup").lower():
            return match.group(0)
        return f"{match.group('prefix')}{match.group('label')}. "

    return _DOUBLED_OPTION_RE.sub(replace, text)


def strip_duplicate_option_label(option: object, label: str) -> str:
    """Strip a leading generated label from one option before markdown adds its own label."""
    text = str(option).strip()
    labels = {label.lower(), label.upper()}
    for candidate in labels:
        for mark in (".", ")"):
            prefix = f"{candidate}{mark} "
            if text.startswith(prefix):
                return text[len(prefix) :].strip()
    return text


def markdown_files() -> list[Path]:
    """Return generated/content markdown paths to check."""
    roots = [
        PROJECT_ROOT / "units",
        PROJECT_ROOT / "assessments",
        PROJECT_ROOT / "pilot",
    ]
    files: list[Path] = []
    for root in roots:
        if root.exists():
            files.extend(root.rglob("*.md"))
    extra_files = [PROJECT_ROOT / "course-intro.md"]
    files.extend(path for path in extra_files if path.exists())
    return sorted(files)


def main(argv: list[str] | None = None) -> None:
    """CLI entry point."""
    parser = argparse.ArgumentParser(description="Check generated TEFL course artifacts.")
    parser.add_argument("--fix", action="store_true", help="rewrite doubled option labels in place")
    args = parser.parse_args(argv)

    all_issues: list[OptionLabelIssue] = []
    for path in markdown_files():
        text = path.read_text(encoding="utf-8")
        issues = find_doubled_option_labels(text, path)
        if args.fix and issues:
            path.write_text(normalize_doubled_option_labels(text), encoding="utf-8")
        all_issues.extend(issues)

    if all_issues:
        for issue in all_issues:
            rel = issue.path.relative_to(PROJECT_ROOT)
            print(f"{rel}:{issue.line}: doubled option label: {issue.text}")
        if not args.fix:
            sys.exit(1)
        print(f"fixed {len(all_issues)} doubled option label(s)")
    else:
        print("tefl-course checks clean")


if __name__ == "__main__":
    main()
