"""Course-local AI-writing style detector.

This is the runnable replacement for the old repo-level `avoid-ai-writing` Node detector. It is
deliberately narrow: `dslop` owns the broad prose lint; this detector catches vocabulary,
transition, and chatbot-register tells that are especially distracting in textbook prose.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import asdict, dataclass
from pathlib import Path


@dataclass(frozen=True)
class StyleIssue:
    """One detector hit."""

    category: str
    pattern: str
    line: int
    weight: int
    snippet: str


@dataclass(frozen=True)
class StyleResult:
    """Detector summary."""

    score: int
    label: str
    issues: list[StyleIssue]

    def to_json(self) -> str:
        """Render the result as stable JSON."""
        return json.dumps(
            {
                "score": self.score,
                "label": self.label,
                "issues": [asdict(issue) for issue in self.issues],
            },
            ensure_ascii=False,
        )


_PATTERNS: tuple[tuple[str, str, int], ...] = (
    ("chatbot-register", r"\b(as an ai|as a language model|i cannot|i'm unable to)\b", 8),
    ("chatbot-register", r"\b(it is important to note|it'?s worth noting|to be clear)\b", 5),
    ("chatbot-register", r"\b(at the end of the day|in today'?s (?:world|landscape))\b", 5),
    ("stock-transition", r"\b(moreover|furthermore|additionally|in conclusion)\b", 3),
    ("stock-transition", r"\b(this underscores|this highlights|this demonstrates)\b", 4),
    ("stock-transition", r"\b(plays a crucial role|serves as a foundation)\b", 4),
    ("ai-lexicon", r"\b(delves?|tapestry|realm|landscape|robust|holistic)\b", 3),
    ("ai-lexicon", r"\b(leverage|utilize|seamless|comprehensive|multifaceted)\b", 3),
    ("ai-lexicon", r"\b(nuanced|dynamic|pivotal|transformative)\b", 2),
    ("stock-contrast", r"\bnot (?:only|just|merely) .{0,80}\bbut (?:also|rather)\b", 5),
    ("stock-contrast", r"\bit'?s not (?:just|only|merely)\b", 5),
)

_COMPILED = tuple(
    (category, re.compile(pattern, re.IGNORECASE), weight)
    for category, pattern, weight in _PATTERNS
)


def analyze_text(text: str) -> StyleResult:
    """Analyze `text` and return a weighted style score."""
    issues: list[StyleIssue] = []
    for line_no, line in enumerate(text.splitlines(), 1):
        for category, pattern, weight in _COMPILED:
            issues.extend(
                StyleIssue(
                    category=category,
                    pattern=pattern.pattern,
                    line=line_no,
                    weight=weight,
                    snippet=_snippet(line, match.start(), match.end()),
                )
                for match in pattern.finditer(line)
            )
    score = sum(issue.weight for issue in issues)
    return StyleResult(score=score, label=_label(score), issues=issues)


def _snippet(line: str, start: int, end: int) -> str:
    """Return a compact single-line snippet around a match."""
    prefix = line[max(0, start - 45) : start]
    hit = line[start:end]
    suffix = line[end : end + 45]
    return " ".join(f"{prefix}{hit}{suffix}".split())


def _label(score: int) -> str:
    """Map score bands to the old detector-style labels."""
    if score < 10:  # noqa: PLR2004
        return "Minimal AI signals"
    if score < 20:  # noqa: PLR2004
        return "Moderate AI signals"
    return "High AI signals"


def main(argv: list[str] | None = None) -> None:
    """CLI entry point."""
    parser = argparse.ArgumentParser(description="Run the TEFL course style detector.")
    parser.add_argument("files", nargs="+", type=Path)
    args = parser.parse_args(argv)

    failed = False
    for path in args.files:
        result = analyze_text(path.read_text(encoding="utf-8"))
        print(result.to_json())
        failed = failed or result.score >= 20  # noqa: PLR2004
    if failed:
        sys.exit(1)


if __name__ == "__main__":
    main()
