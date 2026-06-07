"""Merge-field validation for composed outreach — catch the failures the sent-mail review found.

The review of 113 real sent emails surfaced concrete mail-merge failures that hurt credibility:
unfilled placeholders, wrong recipient names ("Hi Simon," — a hardcoded wrong name), copy/paste
mojibake ("Chibuzor MONECIA RESANDT", stray `Ã`/`Â`), bare generic subjects, and — the single
biggest gap — the absence of an open-ended question (only ~1 of 113 had one).

`validate_email(to, subject, body)` returns a list of problem strings (empty = clean). Each problem
is prefixed `HARD:` or `SOFT:`. The CLI REFUSES to draft an email with any HARD problem
(placeholders, mojibake, missing open-ended question) and merely WARNS on SOFT ones (e.g. a subject
that does not visibly name the role/school). This module is pure text analysis: it never sends or
drafts anything.
"""

from __future__ import annotations

import re

from jobkit.outreach import templates

# Severity prefixes used on every returned problem string.
HARD = "HARD"
SOFT = "SOFT"

# Unfilled merge placeholders: square-bracket tokens ([Name], [School]), curly templates ({{x}}),
# and angle-bracket tokens (<name>). A literal "[" + word is the classic un-substituted field.
_PLACEHOLDER_RE = re.compile(r"\[[A-Za-z][^\]]*\]|\{\{[^}]*\}\}|<[A-Za-z][^>]*>")

# Names that must never appear as the addressee — the "Hi Simon," class of wrong-name merge bugs.
# These are not Chibuzor and not plausible org names; their presence signals a bad merge.
_WRONG_NAMES: frozenset[str] = frozenset({"simon", "monecia", "resandt", "john", "jane", "test"})

# Mojibake / encoding-damage signals: classic UTF-8-as-Latin1 sequences and the U+FFFD replacement
# char. Stray "Ã"/"Â" before another high byte is the tell-tale of a double-decoded body.
_MOJIBAKE_RE = re.compile(r"�|[ÃÂ][-¿]|â€[]")

# A body shorter than this (after stripping the signature) is almost certainly a broken merge.
_MIN_BODY_CHARS = 80

# Greeting line patterns: "Hi <name>," / "Dear <name>," / "Hello <name>," — we extract <name> to
# check it against the wrong-name blocklist.
_GREETING_RE = re.compile(
    r"^\s*(?:hi|hello|dear|hey)\s+([A-Za-z][A-Za-z'\-]*)\s*[,:]",
    re.IGNORECASE,
)


def validate_email(to: str, subject: str, body: str) -> list[str]:
    """Return a list of `HARD:`/`SOFT:`-prefixed problems with the email (empty list = clean).

    HARD problems (placeholders, mojibake, missing open-ended question, empty/too-short body, a
    wrong addressee name, a third-person body, a bare generic subject) must block drafting; SOFT
    problems (subject not naming role/school) are advisory warnings only. Callers split on the
    prefix via `is_hard`.
    """
    problems: list[str] = []
    problems += _check_placeholders(subject, body)
    problems += _check_mojibake(subject, body)
    problems += _check_wrong_name(body)
    problems += _check_body_substance(body)
    problems += _check_question(body)
    problems += _check_voice(body)
    problems += _check_subject(subject)
    problems += _check_recipient(to)
    return problems


def is_hard(problem: str) -> bool:
    """Return True if `problem` is a hard (drafting-blocking) failure."""
    return problem.startswith(f"{HARD}:")


def has_hard_problems(problems: list[str]) -> bool:
    """Return True if any problem in `problems` is hard (should block drafting)."""
    return any(is_hard(p) for p in problems)


def _check_placeholders(subject: str, body: str) -> list[str]:
    """Flag any unfilled merge placeholder in the subject or body."""
    found = sorted({m.group(0) for m in _PLACEHOLDER_RE.finditer(f"{subject}\n{body}")})
    return [f"{HARD}: unfilled placeholder {tok!r}" for tok in found]


def _check_mojibake(subject: str, body: str) -> list[str]:
    """Flag encoding-damage / mojibake in the subject or body."""
    problems: list[str] = []
    for label, text in (("subject", subject), ("body", body)):
        if _MOJIBAKE_RE.search(text):
            problems.append(f"{HARD}: mojibake / encoding damage in {label}")
    return problems


def _check_wrong_name(body: str) -> list[str]:
    """Flag a greeting addressed to a known wrong name (the 'Hi Simon,' merge bug)."""
    match = _GREETING_RE.search(body.lstrip())
    if match is None:
        return []
    name = match.group(1).lower()
    if name in _WRONG_NAMES:
        return [f"{HARD}: addressee greeting uses wrong/placeholder name {match.group(1)!r}"]
    return []


def _check_body_substance(body: str) -> list[str]:
    """Flag an empty or implausibly short body (broken merge)."""
    stripped = _without_signature(body).strip()
    if not stripped:
        return [f"{HARD}: empty body"]
    if len(stripped) < _MIN_BODY_CHARS:
        return [f"{HARD}: body is too short ({len(stripped)} chars) — likely a broken merge"]
    return []


def _check_question(body: str) -> list[str]:
    """Flag a body with no open-ended question (Ben's rule #1; reuses the templates heuristic)."""
    if not templates.has_open_ended_question(body):
        return [f"{HARD}: no open-ended question that requires a reply"]
    return []


def _check_voice(body: str) -> list[str]:
    """Flag a body written in the third person — the email must be in Chibuzor's own voice."""
    if templates.looks_third_person(_without_signature(body)):
        return [f"{HARD}: body refers to the candidate in the third person (not first-person)"]
    return []


# Subjects that are bare and generic — the spray-and-pray pattern the sent-mail review found
# underperforms. The composer can't produce these (it builds `role — school — location` in code),
# so seeing one means the caller bypassed compose; block it.
_BARE_SUBJECTS: frozenset[str] = frozenset(
    {"english teacher", "english teaching", "esl teacher", "teacher", "teaching position", "job"},
)


def _check_subject(subject: str) -> list[str]:
    """Block empty/bare-generic subjects; warn if the subject doesn't name a role or school."""
    text = subject.strip()
    if not text:
        return [f"{HARD}: empty subject"]
    lowered = text.lower()
    if lowered in _BARE_SUBJECTS:
        return [f"{HARD}: bare generic subject {text!r} — must anchor school/location"]
    names_role = any(cue in lowered for cue in ("teacher", "teaching", "esl", "tutor", "english"))
    has_anchor = "—" in text or "-" in text  # school/location separator from subject_line.
    if not names_role and not has_anchor:
        return [f"{SOFT}: subject does not clearly name the role or school"]
    return []


def _check_recipient(to: str) -> list[str]:
    """Flag a missing or malformed recipient address."""
    if not to.strip():
        return [f"{HARD}: missing recipient address"]
    if "@" not in to or "." not in to.rsplit("@", maxsplit=1)[-1]:
        return [f"{HARD}: recipient address looks malformed: {to!r}"]
    return []


def _without_signature(body: str) -> str:
    """Drop a trailing signature block so the substance check measures the real message."""
    idx = body.rfind(templates.SIGNATURE)
    return body[:idx] if idx != -1 else body
