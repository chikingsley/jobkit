"""Content-truth audit gate for TEFL course artifacts.

The original gate (dslop + AI-style detector + quiz format) checks style, not truth.
This module adds the checks that would have caught the 2026-07-17 review findings
mechanically: cast consistency (role / age / nationality / pronouns / artifacts),
verbatim quiz anchors, references hygiene, British spellings, answer-letter and
keyed-option-length balance in the assessment keys, scenario rubrics, punctuation
artifacts, and style-tic counters.

Severities: ERROR blocks (exit 1); WARN is advisory (exit 0 unless --strict).
Allowlist: docs/audit-allowlist.txt, lines of ``<path-suffix>|<check>|<substring>``;
an issue is suppressed when the file path ends with <path-suffix>, the check matches,
and the flagged line contains <substring>. ``*`` matches any check.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Literal, TypedDict

from tefl_course.paths import PROJECT_ROOT

# ---------------------------------------------------------------------------
# Cast definition (docs/cast.md)
# ---------------------------------------------------------------------------


class LearnerProfile(TypedDict):
    """Identity constraints for one recurring learner in the course cast."""

    gender: Literal["f", "m"]
    age: Literal["adult", "teen", "young-adult"]
    identity: set[str]


LEARNERS: dict[str, LearnerProfile] = {
    "Carlos": {"gender": "m", "age": "adult", "identity": {"mexico", "mexican", "spanish"}},
    "Daniel": {"gender": "m", "age": "adult", "identity": {"brazil", "brazilian", "portuguese"}},
    "Wei": {"gender": "m", "age": "adult", "identity": {"china", "chinese", "mandarin"}},
    "Fatima": {"gender": "f", "age": "adult", "identity": {"morocco", "moroccan", "arabic"}},
    "Yuki": {"gender": "f", "age": "teen", "identity": {"japan", "japanese"}},
    "Priya": {"gender": "f", "age": "young-adult", "identity": {"india", "indian", "hindi"}},
}
TEACHERS: dict[str, str] = {"Reyes": "f", "Osei": "m"}
LEARNER_ALT = "|".join(LEARNERS)

# Identity markers that belong to nobody in the cast (or to a different member).
ALL_IDENTITY_TERMS = {term for profile in LEARNERS.values() for term in profile["identity"]} | {
    "russian",
    "cantonese",
    "polish",
    "korean",
    "turkish",
    "thai",
    "vietnamese",
    "shanghai",
    "tokyo",
    "seoul",
    "kowalska",
}

# Names from pre-remap drafts that must not appear (cast.md: use only cast names).
BANNED_NAMES = [
    "Ben",
    "Helen",
    "Amina",
    "Amira",
    "Amara",
    "Hana",
    "Selin",
    "Mateus",
    "Keiko",
    "Farida",
    "Paulo",
    "Yusuf",
    "Tomás",
    "Kowalska",
    "Ajarn Noi",
    "Wei-won",
    "Daniel-ho",
    "Priya-Carlos",
    "São Wei",
]

ROLE_WORDS = r"(?:teacher|trainee teacher|trainee|instructor|tutor)"
NAME_LINKS = r"(?:named|called|like|such as)"

BRITISH_STEMS = [
    "organis",
    "recognis",
    "emphasis",
    "standardis",
    "internalis",
    "contextualis",
    "personalis",
    "categoris",
    "finalis",
    "penalis",
    "generalis",
    "characteris",
    "dramatis",
    "anonymis",
    "conceptualis",
    "apologis",
    "fossilis",
    "individualis",
    "nominalis",
    "specialis",
    "summaris",
    "prioritis",
    "memoris",
    "minimis",
    "maximis",
    "capitalis",
    "normalis",
    "formalis",
    "familiaris",
    "visualis",
    "synthesis",
    "vocalis",
    "verbalis",
    "italicis",
    "hypothesis",
]
_BRITISH_STEM_RE = re.compile(
    r"\b(?:" + "|".join(BRITISH_STEMS) + r")(?:e|ed|es|ing|ation|ations)\b",
    re.IGNORECASE,
)
# "emphasis"/"synthesis"/"hypothesis" as plain nouns are fine; the suffix group above
# only fires on -ise/-ised/-ises/-ising/-isation forms because the stem ends in "is".
_BRITISH_WORDS_RE = re.compile(
    r"\b(?:behaviours?|misbehaviours?|colours?|favourites?|centres?|programmes?|"
    r"learnt|spelt|modelling|modelled|travelled|travelling|counsellors?|"
    r"judgements?|kilometres?|artefacts?|sceptical|scepticism|kinaesthetic|maths|"
    r"practise[sd]?|practising|analyse[sd]?|analysing|double-barrelled|"
    r"unpractised|initialling|initialled|dramatisations?|neighbours?|"
    r"neighbourhoods?|honours?|labour|flavours?|rumours?|theatres?|litres?|"
    r"metres\b|catalogues?|paralyse[sd]?|grey\b)\b",
    re.IGNORECASE,
)

_ANCHOR_RE = re.compile(r"^\s*\*?Anchor:\s*[\"“](?P<quote>.+?)[\"”]\*?\s*$")
_CITATION_RE = re.compile(
    r"\(?\b([A-Z][A-Za-zà-ÿ'-]+)(?:,\s+[A-Z][A-Za-zà-ÿ'-]+)*"
    r"(?:,?\s+(?:and|&)\s+[A-Z][A-Za-zà-ÿ'-]+)?"
    r"(?:\s+et al\.?)?,?\s+\(?(\d{4})\)",
)
_FILENAME_LEAK_RE = re.compile(r"\b\w+_508\b|shaping_frm_observ|\w+\.pdf\b", re.IGNORECASE)
_ANSWER_LETTER_RE = re.compile(r"^\s*\*Answer:\s*([a-d])[.)]", re.MULTILINE)
_ASSESSMENT_OPTION_RE = re.compile(r"^\s{3}([a-d])\.\s+(.+)$", re.MULTILINE)
_ASSESSMENT_ANSWER_RE = re.compile(r"^\s{3}\*Answer:\s*([a-d])\.", re.MULTILINE)
_QUESTION_SPLIT_RE = re.compile(r"(?=^\*\*\d+\.)", re.MULTILINE)

QUIZ_HEADER = "## Check your understanding"
REFS_HEADER = "## References"


@dataclass(frozen=True)
class Issue:
    """One audit finding."""

    path: str
    line: int
    check: str
    severity: str  # "error" | "warn"
    message: str


def _line_no(text: str, pos: int) -> int:
    return text.count("\n", 0, pos) + 1


def _sentences(text: str) -> list[tuple[int, str]]:
    """Split text into (offset, sentence) pairs, coarse but position-preserving."""
    out: list[tuple[int, str]] = []
    for match in re.finditer(r"[^.!?\n]+[.!?]?", text):
        chunk = match.group(0).strip()
        if chunk:
            out.append((match.start(), chunk))
    return out


def _normalize(text: str) -> str:
    # Quote marks are stripped entirely: anchors re-quote body text with different
    # quote characters ('will' vs "will"), and both sides get identical treatment.
    text = re.sub(r"[\"'’‘“”]", "", text)
    text = text.replace("*", "").replace("_", "")
    text = text.replace("—", " ").replace("–", " ")
    return re.sub(r"\s+", " ", text).strip().lower()


def _load_allowlist() -> list[tuple[str, str, str]]:
    path = PROJECT_ROOT / "docs" / "audit-allowlist.txt"
    entries: list[tuple[str, str, str]] = []
    if not path.exists():
        return entries
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split("|", 2)
        if len(parts) == 3:
            entries.append((parts[0], parts[1], parts[2]))
    return entries


def _allowed(issue: Issue, file_text: str, allowlist: list[tuple[str, str, str]]) -> bool:
    lines = file_text.splitlines()
    flagged = lines[issue.line - 1] if 0 < issue.line <= len(lines) else ""
    for suffix, check, substring in allowlist:
        if not issue.path.endswith(suffix):
            continue
        if check not in ("*", issue.check):
            continue
        if substring in flagged or substring in issue.message:
            return True
    return False


# ---------------------------------------------------------------------------
# Cast checks
# ---------------------------------------------------------------------------


def check_cast(text: str, path: str) -> list[Issue]:
    """Role, age, identity, pronoun, artifact, and outsider-name checks."""
    issues: list[Issue] = []

    for match in re.finditer(
        rf"\b{ROLE_WORDS}s?[,]?\s+{NAME_LINKS}\s+({LEARNER_ALT})\b", text, re.IGNORECASE
    ):
        issues.append(
            Issue(
                path,
                _line_no(text, match.start()),
                "cast-role",
                "error",
                f"learner {match.group(1)} used as a teacher: {match.group(0)!r}",
            )
        )
    for match in re.finditer(rf"\b(?:Mr|Ms|Mrs)\.\s+({LEARNER_ALT})\b", text):
        issues.append(
            Issue(
                path,
                _line_no(text, match.start()),
                "cast-role",
                "error",
                f"learner {match.group(1)} with a teacher honorific",
            )
        )
    for match in re.finditer(
        rf"\b(?:A|The|One)\s+{ROLE_WORDS},\s+({LEARNER_ALT})\b", text, re.IGNORECASE
    ):
        issues.append(
            Issue(
                path,
                _line_no(text, match.start()),
                "cast-role",
                "error",
                f"learner {match.group(1)} appositive as teacher: {match.group(0)!r}",
            )
        )
    for match in re.finditer(
        r"\b(?:student|learner)s?,?\s+(?:named|called|like|such as)?\s*"
        r"(?:call (?:him|her)\s+)?(Mr\. Osei|Ms\. Reyes)\b",
        text,
    ):
        issues.append(
            Issue(
                path,
                _line_no(text, match.start()),
                "cast-role",
                "error",
                f"cast teacher {match.group(1)} used as a learner",
            )
        )

    for name in BANNED_NAMES:
        for match in re.finditer(rf"\b{re.escape(name)}\b", text):
            issues.append(
                Issue(
                    path,
                    _line_no(text, match.start()),
                    "cast-outsider",
                    "error",
                    f"pre-remap / out-of-cast name {name!r}",
                )
            )
    cast_ok = set(LEARNERS) | {"Reyes", "Osei", "Mr", "Ms", "Mrs"}
    for match in re.finditer(
        r"\b(?:student|learner|teacher|child|trainee|colleague)s?\s+"
        r"(?:named|called)\s+([A-Z][a-zà-ÿ]+)",
        text,
    ):
        if match.group(1) not in cast_ok:
            issues.append(
                Issue(
                    path,
                    _line_no(text, match.start()),
                    "cast-outsider",
                    "error",
                    f"named example outside the cast: {match.group(1)!r}",
                )
            )

    for match in re.finditer(rf"\b({LEARNER_ALT})-[A-Za-zà-ÿ]+\b", text):
        issues.append(
            Issue(
                path,
                _line_no(text, match.start()),
                "cast-artifact",
                "error",
                f"fused/malformed cast name: {match.group(0)!r}",
            )
        )
    for match in re.finditer(rf"\b({LEARNER_ALT})\b[^.\n]{{0,20}}\band\s+\1\b", text):
        issues.append(
            Issue(
                path,
                _line_no(text, match.start()),
                "cast-artifact",
                "error",
                f"duplicate name in coordination: {match.group(0)!r}",
            )
        )

    child_cue = re.compile(
        r"\b(?:children?|boys?|girls?|(?:five|six|seven|eight|nine|ten|eleven|twelve|"
        r"[3-9]|1[0-2])[- ]year[- ]olds?|first-graders?|kindergart(?:en|ners?))\b",
        re.IGNORECASE,
    )
    adult_cue = re.compile(
        r"\b(?:adult|professional|analyst|manager|engineer|financial|procurement|"
        r"compliance officer|director|works in)\b",
        re.IGNORECASE,
    )
    for offset, sentence in _sentences(text):
        for name, spec in LEARNERS.items():
            if not re.search(rf"\b{name}\b", sentence):
                continue
            line = _line_no(text, offset)
            if spec["age"] in ("adult", "young-adult") and child_cue.search(sentence):
                issues.append(
                    Issue(
                        path,
                        line,
                        "cast-age",
                        "error",
                        f"{name} ({spec['age']}) in a child context: {sentence[:90]!r}",
                    )
                )
            if spec["age"] == "teen":
                if child_cue.search(sentence):
                    issues.append(
                        Issue(
                            path,
                            line,
                            "cast-age",
                            "error",
                            f"Yuki (teenager) in a young-child context: {sentence[:90]!r}",
                        )
                    )
                elif adult_cue.search(sentence):
                    issues.append(
                        Issue(
                            path,
                            line,
                            "cast-age",
                            "warn",
                            f"Yuki (teenager) in an adult context: {sentence[:90]!r}",
                        )
                    )
            wrong_terms = ALL_IDENTITY_TERMS - spec["identity"]
            other_names = [n for n in LEARNERS if n != name]
            for term in wrong_terms:
                term_match = re.search(rf"\b{term}\b", sentence, re.IGNORECASE)
                if not term_match:
                    continue
                between = sentence[: term_match.start()]
                if any(re.search(rf"\b{o}\b", between) for o in other_names):
                    continue  # the term likely belongs to another cast member mentioned first
                strong = re.search(
                    rf"\b{name}\b,?\s+(?:[^.]{{0,25}})?\b(?:whose first language is|from|"
                    rf"native|speaker of|a|an)\s+(?:\w+[- ])?{term}\b",
                    sentence,
                    re.IGNORECASE,
                )
                issues.append(
                    Issue(
                        path,
                        _line_no(text, offset),
                        "cast-identity",
                        "error" if strong else "warn",
                        f"{name} near wrong identity term {term!r}: {sentence[:90]!r}",
                    )
                )

        for name, spec in LEARNERS.items():
            name_match = re.search(rf"\b{name}\b", sentence)
            if name_match is None:
                continue
            wrong = (
                r"\b(?:she|her|hers|herself)\b"
                if spec["gender"] == "m"
                else r"\b(?:he|him|his|himself)\b"
            )
            opposite = [n for n, s in LEARNERS.items() if s["gender"] != spec["gender"]]
            opposite += ["Reyes" if spec["gender"] == "m" else "Osei"]
            if any(re.search(rf"\b{o}\b", sentence) for o in opposite):
                continue
            # Only treat the first nearby personal pronoun as a plausible coreference. Later
            # pronouns commonly refer to another person from the preceding sentence or to the
            # object of reported speech ("Yuki said she would call him").
            after = sentence[name_match.end() : name_match.end() + 60]
            first_pronoun = re.search(
                r"\b(?:she|her|hers|herself|he|him|his|himself)\b", after, re.IGNORECASE
            )
            if first_pronoun and re.fullmatch(wrong, first_pronoun.group(0), re.IGNORECASE):
                issues.append(
                    Issue(
                        path,
                        _line_no(text, offset),
                        "cast-pronoun",
                        "warn",
                        f"{name} followed by wrong-gender pronoun: {sentence[:90]!r}",
                    )
                )
        for honorific, gender in (("Mr\\. Osei", "m"), ("Ms\\. Reyes", "f")):
            honorific_match = re.search(honorific, sentence)
            if honorific_match is None:
                continue
            wrong = (
                r"\b(?:she|her|hers|herself)\b" if gender == "m" else r"\b(?:he|him|his|himself)\b"
            )
            opposite = [n for n, s in LEARNERS.items() if s["gender"] != gender]
            if any(re.search(rf"\b{o}\b", sentence) for o in opposite):
                continue
            after = sentence[honorific_match.end() :]
            if re.search(wrong, after, re.IGNORECASE):
                issues.append(
                    Issue(
                        path,
                        _line_no(text, offset),
                        "cast-pronoun",
                        "error",
                        f"{honorific} followed by wrong-gender pronoun: {sentence[:90]!r}",
                    )
                )
    return issues


# ---------------------------------------------------------------------------
# Anchors, references, spelling, punctuation, style
# ---------------------------------------------------------------------------


def _anchor_parts(quote: str) -> list[str]:
    """Normalize an anchor, split on ellipses, strip terminal punctuation per part.

    Returns [] for pointer-style anchors ("unit 1.4 quiz") that reference a
    source rather than quote it.
    """
    normalized = _normalize(quote)
    if re.fullmatch(r"unit \d+\.\d+ quiz", normalized):
        return []
    parts = [
        p.strip().rstrip(".?!,;:").strip() for p in re.split(r"\s*(?:\.\.\.|…)\s*", normalized)
    ]
    return [p for p in parts if p]


def check_anchors(text: str, path: str) -> list[Issue]:
    """Every quiz anchor must be a verbatim (normalized) substring of the unit body."""
    if QUIZ_HEADER not in text:
        return []
    body, _, quiz = text.partition(QUIZ_HEADER)
    norm_body = _normalize(body)
    issues: list[Issue] = []
    base = len(body.splitlines())
    for i, line in enumerate(quiz.splitlines(), start=base):
        match = _ANCHOR_RE.match(line)
        if not match:
            continue
        parts = _anchor_parts(match.group("quote"))
        if parts and not all(part in norm_body for part in parts):
            issues.append(
                Issue(
                    path,
                    i + 1,
                    "anchor-verbatim",
                    "error",
                    f"anchor not found verbatim in body: {match.group('quote')[:80]!r}",
                )
            )
    return issues


def check_references(text: str, path: str) -> list[Issue]:
    """References must exist, be non-empty, and cover in-text (Author, year) citations."""
    issues: list[Issue] = []
    if REFS_HEADER not in text:
        issues.append(
            Issue(path, len(text.splitlines()), "references", "error", "no ## References section")
        )
        return issues
    body, _, refs = text.partition(REFS_HEADER)
    if not refs.strip():
        issues.append(
            Issue(
                path, len(text.splitlines()), "references", "error", "References section is empty"
            )
        )
    prose = body.partition(QUIZ_HEADER)[0]
    seen: set[str] = set()
    for match in _CITATION_RE.finditer(prose):
        surname, year = match.group(1), match.group(2)
        if surname in seen or not (1900 <= int(year) <= 2030):
            continue
        seen.add(surname)
        if surname.lower() not in refs.lower():
            issues.append(
                Issue(
                    path,
                    _line_no(prose, match.start()),
                    "references",
                    "error",
                    f"in-text citation {surname} ({year}) missing from References",
                )
            )
    for match in _FILENAME_LEAK_RE.finditer(prose):
        issues.append(
            Issue(
                path,
                _line_no(prose, match.start()),
                "filename-leak",
                "error",
                f"internal filename in prose: {match.group(0)!r}",
            )
        )
    return issues


def check_spelling(text: str, path: str) -> list[Issue]:
    """British spellings in an American-English course."""
    issues: list[Issue] = []
    for regex in (_BRITISH_STEM_RE, _BRITISH_WORDS_RE):
        for match in regex.finditer(text):
            word = match.group(0)
            if word.lower() in {"emphasis", "synthesis", "hypothesis", "analyses", "metres"}:
                # bare nouns / ambiguous plural ("analyses" as noun) are acceptable
                if word.lower() != "metres":
                    continue
            issues.append(
                Issue(
                    path,
                    _line_no(text, match.start()),
                    "spelling",
                    "error",
                    f"British spelling: {word!r}",
                )
            )
    return issues


def check_punctuation(text: str, path: str) -> list[Issue]:
    """Editing-artifact punctuation."""
    issues: list[Issue] = []
    for match in re.finditer(r"[\w\"'’] ,", text):
        issues.append(
            Issue(
                path,
                _line_no(text, match.start()),
                "punctuation",
                "error",
                f"space before comma: {match.group(0)!r}",
            )
        )
    # Genuinely empty/broken quotes ('that " " carries', '" ?"'), not "a," "b" lists.
    for match in re.finditer(r"(?<=[a-zA-Z] )[\"“] [\"”](?= )|[\"“] \?[\"”]|“\s*”", text):
        issues.append(
            Issue(
                path,
                _line_no(text, match.start()),
                "punctuation",
                "error",
                f"empty or broken quotation: {match.group(0)!r}",
            )
        )
    return issues


def check_style(text: str, path: str) -> list[Issue]:
    """Advisory counters for machine-writing tics."""
    issues: list[Issue] = []
    body = text.partition(QUIZ_HEADER)[0]
    named = len(re.findall(r"\b(?:student|teacher|learner|child|trainee)s? named\b", body))
    if named > 4:
        issues.append(
            Issue(
                path,
                1,
                "style-named",
                "warn",
                f'"... named X" scaffold used {named}x (cast.md says a few per unit)',
            )
        )
    source_talk = len(re.findall(r"\b[Tt]he source\b", body))
    if source_talk > 3:
        issues.append(
            Issue(
                path,
                1,
                "style-source-talk",
                "warn",
                f'"the source ..." pipeline framing appears {source_talk}x',
            )
        )
    consider = len(re.findall(r"(?:^|\. )Consider\b", body))
    if consider > 2:
        issues.append(
            Issue(path, 1, "style-consider", "warn", f'"Consider ..." opener used {consider}x')
        )
    frags = []
    for line in body.splitlines():
        if re.match(r"\s*(?:[TS]\d?\s*[:\[]|#)", line):
            continue
        frags += re.findall(r"(?<=\. )([A-Z][a-z]+(?: [a-z]+)?\.)(?= [A-Z])", line)
    frags = [
        f
        for f in frags
        if f.rstrip(".").lower() not in {"reyes", "osei", "mr", "mrs", "ms", "no", "yes"}
        and len(f.split()) <= 2
    ]
    if len(frags) > 1:
        issues.append(
            Issue(path, 1, "style-fragment", "warn", f"staccato fragments: {', '.join(frags[:6])}")
        )
    return issues


def check_bank_anchors(unit_md: Path) -> list[Issue]:
    """A unit's bank.json anchors must stay verbatim quotes of the unit body."""
    bank = unit_md.parent / "bank.json"
    if not bank.exists():
        return []
    rel = str(bank.relative_to(PROJECT_ROOT)) if bank.is_relative_to(PROJECT_ROOT) else str(bank)
    body = unit_md.read_text(encoding="utf-8").partition(QUIZ_HEADER)[0]
    norm_body = _normalize(body)
    issues: list[Issue] = []
    try:
        entries = json.loads(bank.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        return [Issue(rel, 1, "bank-anchor", "error", f"bank.json unparseable: {exc}")]
    for i, entry in enumerate(entries if isinstance(entries, list) else []):
        anchor = entry.get("anchor", "") if isinstance(entry, dict) else ""
        if not anchor:
            continue
        parts = _anchor_parts(anchor)
        if parts and not all(part in norm_body for part in parts):
            issues.append(
                Issue(
                    rel,
                    1,
                    "bank-anchor",
                    "error",
                    f"bank entry {i + 1} anchor not verbatim in unit body: {anchor[:80]!r}",
                )
            )
    return issues


def check_assessment_anchors(paths: list[Path]) -> list[Issue]:
    """Assessment anchors quote unit text; verify each against the whole unit corpus.

    This is the sync safety-net: editing a unit body can silently orphan the
    module-test / final-exam anchors that quote it.
    """
    # Full files, not just bodies: Section B recycles unit-quiz items verbatim,
    # so assessment anchors may legitimately quote a unit's quiz section.
    corpus_parts: list[str] = []
    for unit in sorted((PROJECT_ROOT / "units").rglob("unit.md")):
        corpus_parts.append(_normalize(unit.read_text(encoding="utf-8")))
    corpus = "\n".join(corpus_parts)
    issues: list[Issue] = []
    for path in paths:
        rel = (
            str(path.relative_to(PROJECT_ROOT)) if path.is_relative_to(PROJECT_ROOT) else str(path)
        )
        for i, line in enumerate(path.read_text(encoding="utf-8").splitlines()):
            match = _ANCHOR_RE.match(line)
            if not match:
                continue
            parts = _anchor_parts(match.group("quote"))
            if parts and not all(part in corpus for part in parts):
                issues.append(
                    Issue(
                        rel,
                        i + 1,
                        "assessment-anchor",
                        "error",
                        f"anchor not found in any unit body: {match.group('quote')[:80]!r}",
                    )
                )
    return issues


def check_answer_balance(paths: list[Path]) -> list[Issue]:
    """Aggregate MCQ answer-letter distribution across assessment keys."""
    counts: dict[str, int] = {"a": 0, "b": 0, "c": 0, "d": 0}
    per_file: dict[str, dict[str, int]] = {}
    for path in paths:
        text = path.read_text(encoding="utf-8")
        letters = _ANSWER_LETTER_RE.findall(text)
        if letters:
            per_file[str(path)] = {k: letters.count(k) for k in counts}
            for letter in letters:
                counts[letter] += 1
    total = sum(counts.values())
    issues: list[Issue] = []
    if not total:
        return issues
    for letter, n in counts.items():
        share = n / total
        if share > 0.40 or share < 0.10:
            issues.append(
                Issue(
                    "assessments/",
                    1,
                    "answer-balance",
                    "error",
                    f"keyed answer {letter!r} is {share:.0%} of {total} MCQs "
                    f"(target 10%-40% per letter); full: "
                    + ", ".join(f"{k}={v}" for k, v in counts.items()),
                )
            )
            break
    return issues


def check_option_length_bias(paths: list[Path]) -> list[Issue]:
    """Reject a course-wide pattern in which the keyed option is usually the longest."""
    total = 0
    keyed_longest = 0
    for path in paths:
        for block in _QUESTION_SPLIT_RE.split(path.read_text(encoding="utf-8")):
            options = dict(_ASSESSMENT_OPTION_RE.findall(block))
            answer = _ASSESSMENT_ANSWER_RE.search(block)
            if len(options) != 4 or answer is None:
                continue
            key = answer.group(1)
            total += 1
            keyed_longest += len(options[key]) > max(
                len(option) for label, option in options.items() if label != key
            )
    if total and keyed_longest / total > 0.40:
        return [
            Issue(
                "assessments/",
                1,
                "option-length-bias",
                "error",
                f"keyed option is strictly longest in {keyed_longest}/{total} MCQs "
                f"({keyed_longest / total:.0%}; maximum 40%)",
            )
        ]
    return []


def check_scenario_rubrics(paths: list[Path]) -> list[Issue]:
    """Every scenario in a grading key needs explicit score-band guidance."""
    issues: list[Issue] = []
    for path in paths:
        expected = 3 if path.name == "final-exam-key.md" else 1
        actual = path.read_text(encoding="utf-8").count("### Scoring guidance")
        if actual != expected:
            issues.append(
                Issue(
                    str(path.relative_to(PROJECT_ROOT)),
                    1,
                    "scenario-rubric",
                    "error",
                    f"expected {expected} scoring-guidance block(s), found {actual}",
                )
            )
    return issues


# ---------------------------------------------------------------------------
# Driver
# ---------------------------------------------------------------------------

UNIT_CHECKS = (
    check_cast,
    check_anchors,
    check_references,
    check_spelling,
    check_punctuation,
    check_style,
)
ASSESSMENT_CHECKS = (check_cast, check_spelling, check_punctuation)


def audit_file(path: Path) -> list[Issue]:
    """Run the applicable checks for one markdown file."""
    text = path.read_text(encoding="utf-8")
    rel = str(path.relative_to(PROJECT_ROOT)) if path.is_relative_to(PROJECT_ROOT) else str(path)
    checks = UNIT_CHECKS if "units/" in rel or rel == "course-intro.md" else ASSESSMENT_CHECKS
    if rel == "course-intro.md":
        checks = (check_cast, check_spelling, check_punctuation)
    issues: list[Issue] = []
    for check in checks:
        issues.extend(check(text, rel))
    allowlist = _load_allowlist()
    if allowlist:
        issues = [i for i in issues if not _allowed(i, text, allowlist)]
    return sorted(set(issues), key=lambda i: (i.line, i.check, i.message))


def default_targets() -> list[Path]:
    """All auditable content files."""
    files = sorted((PROJECT_ROOT / "units").rglob("unit.md"))
    files += sorted((PROJECT_ROOT / "assessments").glob("*.md"))
    intro = PROJECT_ROOT / "course-intro.md"
    if intro.exists():
        files.append(intro)
    return files


def main(argv: list[str] | None = None) -> None:
    """CLI entry point."""
    parser = argparse.ArgumentParser(
        description="Audit TEFL course content for truth-level defects."
    )
    parser.add_argument("paths", nargs="*", help="files to audit (default: all content)")
    parser.add_argument("--json", action="store_true", help="emit JSON")
    parser.add_argument("--strict", action="store_true", help="warnings also fail")
    parser.add_argument("--no-warn", action="store_true", help="suppress warnings in output")
    args = parser.parse_args(argv)

    targets = [Path(p).resolve() for p in args.paths] if args.paths else default_targets()
    issues: list[Issue] = []
    for path in targets:
        issues.extend(audit_file(path))
    key_files = [
        p
        for p in targets
        if (p.name.startswith("module-") and "key" in p.name) or p.name == "final-exam-key.md"
    ]
    issues.extend(check_answer_balance(key_files))
    issues.extend(check_option_length_bias(key_files))
    issues.extend(check_scenario_rubrics(key_files))
    assessment_files = [p for p in targets if "assessments" in str(p) and p.suffix == ".md"]
    issues.extend(check_assessment_anchors(assessment_files))
    for path in targets:
        if path.name == "unit.md":
            issues.extend(check_bank_anchors(path))

    if args.no_warn:
        issues = [i for i in issues if i.severity == "error"]
    issues.sort(key=lambda i: (i.path, i.line, i.check))

    if args.json:
        print(json.dumps([asdict(i) for i in issues], indent=1))
    else:
        for issue in issues:
            print(f"{issue.path}:{issue.line}: [{issue.severity}] {issue.check}: {issue.message}")
        errors = sum(1 for i in issues if i.severity == "error")
        warns = sum(1 for i in issues if i.severity == "warn")
        print(f"\naudit: {errors} error(s), {warns} warning(s) across {len(targets)} file(s)")

    has_fail = any(i.severity == "error" for i in issues) or (
        args.strict and any(i.severity == "warn" for i in issues)
    )
    sys.exit(1 if has_fail else 0)


if __name__ == "__main__":
    main()
