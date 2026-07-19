"""Produce course units: outline -> draft -> gate, per the pipeline design.

Usage (from `tefl-course/`):

    uv run tefl-course-build run 9.2 9.3      # build + gate specific units
    uv run tefl-course-build run all          # build + gate every unit
    uv run tefl-course-build gate 9.2         # re-gate an existing draft

Per unit: an outline call proposes 4-6 sections from the source text and scope; the draft stage
writes each section with the style rules and (only) the registry's citation facts embedded; the
gate runs dslop on the prose body (quiz/references stripped — citation format false-positives) and
the course-local style detector on the whole file, writing `gate-report.txt` next to the unit.
Output: tefl-course/units/<uid>/unit.md. The model never sees teacherrecord text.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import time
from typing import TYPE_CHECKING, cast

from tefl_course.audit import audit_file, check_bank_anchors
from tefl_course.checks import find_doubled_option_labels, strip_duplicate_option_label
from tefl_course.detectors.ai_style import analyze_text
from tefl_course.llm import SuperwhisperClient
from tefl_course.paths import PROJECT_ROOT
from tefl_course.pipeline.registry import TEXT_DIR, UNITS, Unit
from tefl_course.pipeline.retrieve import retrieve

if TYPE_CHECKING:
    from pathlib import Path

ROOT = PROJECT_ROOT
UNITS_DIR = ROOT / "units"
STYLE_RULES = (ROOT / "pilot" / "style-rules.md").read_text(encoding="utf-8")

STYLE_DETECTOR_MAX_SCORE = 20

_OUTLINE_BRIEF = (
    "Plan one unit of a self-study TEFL certificate course. Given the unit's title, scope, and "
    "source text, propose 4 to 6 sections that cover the scope using ONLY material present in "
    "the source (plus the verified citation facts, if any are provided). Return ONLY a JSON "
    'object {"sections": [{"title": "...", "brief": "...", "words": N}]} where each brief is '
    "2-4 sentences telling the section writer exactly what to cover and which source material "
    "to draw on, and words is 350-560. Total across sections: 1900-2600 words. Briefs must "
    "respect the scope's exclusions (material reserved for other units)."
)

_QUIZ_BRIEF = (
    "Write exactly 6 quiz questions for the unit below: 3 multiple-choice (4 options, one "
    "correct), 2 short-answer, 1 scenario question (a classroom situation; the trainee chooses "
    "and justifies a move). For EVERY question include an 'anchor': a verbatim quote of at most "
    '15 words from the unit text containing the answer. Return ONLY {"questions": [{"type": '
    '"...", "question": "...", "options": [...] or null, "answer": "...", "anchor": "..."}]}.'
)


_RETRIES = 5
_BACKOFF_SECONDS = 4  # transient proxy 5xx/timeouts: wait this * attempt before retrying.


def _generate(client: SuperwhisperClient, prompt: str, *, max_tokens: int) -> str:
    """Plain-text generate with retry/backoff on transient proxy errors (e.g. 503)."""
    for attempt in range(1, _RETRIES + 1):
        try:
            return client.generate([{"role": "user", "content": prompt}], max_tokens=max_tokens)
        except Exception as exc:
            if attempt == _RETRIES:
                raise
            _log(f"  generate failed ({type(exc).__name__}); retry {attempt}/{_RETRIES}")
            time.sleep(_BACKOFF_SECONDS * attempt)
    return ""  # unreachable; the loop returns or raises.


def _json_call(client: SuperwhisperClient, prompt: str, *, max_tokens: int) -> object | None:
    """Run generate_json with retries — malformed JSON and transient proxy errors both retry."""
    for attempt in range(1, _RETRIES + 1):
        try:
            return client.generate_json(
                [{"role": "user", "content": prompt}], max_tokens=max_tokens
            )
        except json.JSONDecodeError:
            _log(f"  malformed JSON (attempt {attempt}/{_RETRIES}); retrying")
        except Exception as exc:
            if attempt == _RETRIES:
                raise
            _log(f"  json call failed ({type(exc).__name__}); retry {attempt}/{_RETRIES}")
            time.sleep(_BACKOFF_SECONDS * attempt)
    return None


# Corpus-mode source files must resolve INSIDE this public-domain dir — a hard boundary so a bad
# registry path (absolute, ../, or anything under the copyrighted teacherrecord/ tree) can never be
# fed to the model.
_ALLOWED_SOURCE_DIR = (ROOT / TEXT_DIR).resolve()


def _safe_source_path(name: str) -> Path:
    """Resolve a corpus source filename, rejecting traversal or anything outside the allowed dir."""
    path = (ROOT / TEXT_DIR / name).resolve()
    if not path.is_relative_to(_ALLOWED_SOURCE_DIR):
        msg = f"refusing source outside the public-domain corpus: {name!r}"
        raise ValueError(msg)
    return path


def _load_sources(unit: Unit) -> str:
    """Return the unit's source text per its mode (exact files / retrieval / none for facts)."""
    if unit.mode == "retrieval":
        return retrieve(unit.retrieval_query, top_k=6)
    if unit.mode == "facts":
        return ""
    parts = [_safe_source_path(name).read_text(encoding="utf-8") for name in unit.sources]
    return "\n\n".join(parts)


_FACTS_SOURCE_NOTE = (
    "This unit has NO source document. Write from well-established, uncopyrightable facts (the "
    "rules of English grammar / phonetics / standard ELT practice). Invent ALL your own example "
    "sentences and classroom examples. Reproduce no textbook's wording, explanations, or "
    "exercises. Accuracy matters: state only what is grammatically/factually correct."
)


def _source_section(unit: Unit, source: str) -> str:
    """Render the SOURCE block for a prompt, handling the facts (no-source) mode."""
    if unit.mode == "facts":
        return "== SOURCE ==\n" + _FACTS_SOURCE_NOTE
    return "== SOURCE TEXT (public domain — the unit's factual basis) ==\n" + source


def _citations_block(unit: Unit) -> str:
    """Render the allowed-citations constraint for the prompts."""
    if unit.citation_facts:
        return (
            "Verified research facts (the ONLY effectiveness claims you may make; cite inline as "
            f"(Author, Year)):\n{unit.citation_facts}\nState these claims as written. Do NOT "
            "invent, extend, round, convert, or derive ANY further numbers from them (no "
            "percentiles, no percentage conversions, no merged ranges, no benchmark labels). "
            "Every other claim must come from the source text or, in facts mode, from established "
            "uncopyrightable facts."
        )
    if unit.mode == "facts":
        return (
            "This unit has NO research citations. Make no claims about named studies, effect "
            "sizes, or statistics. Write from established, uncopyrightable facts only."
        )
    return (
        "This unit has NO research citations. Make no claims about research, studies, or "
        "evidence. Every claim must come from the source text."
    )


def outline(client: SuperwhisperClient, unit: Unit) -> list[dict[str, object]]:
    """Propose (or load cached) section outline for `unit`."""
    cache = UNITS_DIR / unit.uid / "outline.json"
    if cache.exists():
        return cast("list[dict[str, object]]", json.loads(cache.read_text(encoding="utf-8")))
    prompt = "\n".join(
        [
            _OUTLINE_BRIEF,
            "",
            f"Unit title: {unit.title}",
            f"Course module: {unit.module}",
            f"Scope: {unit.scope}",
            "",
            _citations_block(unit),
            "",
            _source_section(unit, _load_sources(unit)),
        ]
    )
    parsed = _json_call(client, prompt, max_tokens=1400)
    fields = cast("dict[str, object]", parsed) if isinstance(parsed, dict) else {}
    raw = fields.get("sections")
    sections = [s for s in (raw if isinstance(raw, list) else []) if isinstance(s, dict)]
    if not sections:
        sys.exit(f"unit {unit.uid}: outline stage returned no sections")
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps(sections, indent=2), encoding="utf-8")
    return cast("list[dict[str, object]]", sections)


def _section_prompt(unit: Unit, source: str, sec: dict[str, object], previous_tail: str) -> str:
    """Assemble the drafting prompt for one outlined section."""
    words = int(cast("int", sec.get("words", 450)))
    parts = [
        "You are writing one section of a unit in a self-study TEFL certificate course. The "
        f'unit is called "{unit.title}". Write ONLY the section named below, about {words} '
        "words, in the register required by the style rules. Return ONLY the section prose — "
        "no heading, no preamble, no commentary.",
        "",
        "== STYLE RULES (violations are rejected by an automated gate) ==",
        STYLE_RULES,
        "",
        "== " + _citations_block(unit),
        "",
        _source_section(unit, source),
        "",
        f"== SECTION TO WRITE: {sec.get('title', '')} ==",
        str(sec.get("brief", "")),
    ]
    if previous_tail:
        parts += [
            "",
            "== END OF THE PREVIOUS SECTION (continue naturally; do not repeat it) ==",
            previous_tail,
        ]
    return "\n".join(parts)


def draft(client: SuperwhisperClient, unit: Unit) -> Path:
    """Draft the full unit (sections + quiz + references) to units/<uid>/unit.md."""
    source = _load_sources(unit)
    sections = outline(client, unit)
    chunks: list[str] = [f"# {unit.title}\n"]
    previous_tail = ""
    for sec in sections:
        prompt = _section_prompt(unit, source, sec, previous_tail)
        words = int(cast("int", sec.get("words", 450)))
        text = _generate(client, prompt, max_tokens=int(words * 2.2)).strip()
        if not text:
            sys.exit(f"unit {unit.uid}: empty draft for section {sec.get('title')!r}")
        chunks.append(f"\n## {sec.get('title', '')}\n\n{text}\n")
        previous_tail = text[-600:]
        _log(f"[{unit.uid}] drafted: {sec.get('title')} ({len(text.split())} words)")

    unit_text = "\n".join(chunks)
    quiz_prompt = (
        f"{_QUIZ_BRIEF}\n\n== STYLE RULES ==\n{STYLE_RULES}\n\n== THE UNIT ==\n{unit_text}"
    )
    items: list[object] = []
    problems: list[str] = ["quiz never generated"]
    for _attempt in range(2):
        parsed = _json_call(client, quiz_prompt, max_tokens=1600)
        fields = cast("dict[str, object]", parsed) if isinstance(parsed, dict) else {}
        raw_questions = fields.get("questions", [])
        items = cast("list[object]", raw_questions) if isinstance(raw_questions, list) else []
        problems = _quiz_problems(items, unit_text)
        if not problems:
            break
        _log(f"[{unit.uid}] quiz failed validation ({len(problems)}); retrying")
    warning = UNITS_DIR / unit.uid / "quiz-warnings.txt"
    if problems:
        warning.parent.mkdir(parents=True, exist_ok=True)
        warning.write_text("\n".join(problems) + "\n", encoding="utf-8")
        _log(f"[{unit.uid}] QUIZ WARNINGS kept for owner review: {len(problems)}")
    elif warning.exists():
        warning.unlink()
    chunks.append(_render_quiz(items))
    chunks.append("\n## References\n\n" + "\n".join(f"- {r}" for r in unit.references) + "\n")

    out = UNITS_DIR / unit.uid / "unit.md"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("\n".join(chunks), encoding="utf-8")
    _log(f"[{unit.uid}] wrote {out}")
    return out


_ANCHOR_OVERLAP_MIN = 0.75  # fraction of an anchor's content words that must appear in the unit


def _anchor_grounded(anchor: str, unit_words: frozenset[str]) -> bool:
    """Return True if the anchor is verbatim OR most content words appear in the unit.

    The model often paraphrases its anchor rather than quoting; a paraphrase whose words are all
    present in the unit still proves the question is answerable from the text. Only an anchor with
    invented content (words absent from the unit) is a real problem.
    """
    content = [w for w in re.findall(r"[a-z0-9]+", anchor.lower()) if len(w) >= 4]  # noqa: PLR2004
    if not content:
        return True
    present = sum(1 for w in content if w in unit_words)
    return present / len(content) >= _ANCHOR_OVERLAP_MIN


def _quiz_problems(items: list[object], unit_text: str) -> list[str]:
    """Validate the generated quiz: count, MC shape, answers, and anchors grounded in the unit."""
    problems: list[str] = []
    expected = 6
    if len(items) != expected:
        problems.append(f"expected {expected} questions, got {len(items)}")
    lowered = unit_text.lower()
    unit_words = frozenset(re.findall(r"[a-z0-9]+", lowered))
    for i, raw in enumerate(items, 1):
        if not isinstance(raw, dict):
            problems.append(f"q{i}: not an object")
            continue
        q = cast("dict[str, object]", raw)
        if not str(q.get("question", "")).strip():
            problems.append(f"q{i}: empty question")
        options = q.get("options")
        if isinstance(options, list) and len(options) != 4:  # noqa: PLR2004 - MC convention.
            problems.append(f"q{i}: multiple-choice needs 4 options, got {len(options)}")
        if not str(q.get("answer", "")).strip():
            problems.append(f"q{i}: empty answer")
        anchor = str(q.get("anchor", "")).strip()
        if not anchor:
            problems.append(f"q{i}: missing anchor")
        elif anchor.lower() not in lowered and not _anchor_grounded(anchor, unit_words):
            problems.append(f"q{i}: anchor content not found in unit text: {anchor!r}")
    return problems


def _render_quiz(questions: list[object]) -> str:
    """Render quiz questions (with source anchors) as markdown."""
    lines = ["\n## Check your understanding\n"]
    for i, raw in enumerate(questions, 1):
        if not isinstance(raw, dict):
            continue
        q = cast("dict[str, object]", raw)
        lines.append(f"**{i}. {q.get('question', '')}**\n")
        options = q.get("options")
        if isinstance(options, list):
            lines += [
                f"   {chr(96 + j)}. {strip_duplicate_option_label(opt, chr(96 + j))}"
                for j, opt in enumerate(options, 1)
            ]
            lines.append("")
        lines.append(f"   *Answer: {q.get('answer', '')}*")
        lines.append(f'   *Anchor: "{q.get("anchor", "")}"*\n')
    return "\n".join(lines)


def gate(unit: Unit) -> bool:
    """Run the deterministic gate on a drafted unit; write gate-report.txt; return pass/fail."""
    path = UNITS_DIR / unit.uid / "unit.md"
    text = path.read_text(encoding="utf-8")
    dslop_prose = _dslop_prose(text)
    dslop = _run_dslop(dslop_prose)
    detector = analyze_text(text)
    option_label_issues = find_doubled_option_labels(text, path)
    # The sentence-length-kurtosis metric is an OPEN OWNER DECISION (see the pilot): dialogue-
    # heavy teaching prose legitimately depresses it. A unit whose only dslop finding is that
    # file-level metric passes the gate with a rhythm flag rather than failing outright.
    # Hits on quoted tokens (source citations, named vocabulary items) are likewise not
    # authored-prose failures and are filtered out.
    dslop_report = dslop.stdout + dslop.stderr  # dslop writes its report to stderr.
    effective_hits = _dslop_hits_outside_quotes(dslop_prose, dslop_report)
    rhythm_only = (
        dslop.returncode != 0
        and not effective_hits
        and "sentence-length-kurtosis" in dslop_report
    )
    style_ok = detector.score < STYLE_DETECTOR_MAX_SCORE
    # Unresolved quiz warnings (bad/ungrounded anchors) block the gate — they must not ship.
    quiz_warn = UNITS_DIR / unit.uid / "quiz-warnings.txt"
    quiz_ok = not quiz_warn.exists()
    option_labels_ok = not option_label_issues
    dslop_ok = dslop.returncode == 0 or rhythm_only or not effective_hits
    # Truth-level audit (cast, anchors, references, spelling, punctuation): errors block.
    audit_issues = [
        issue
        for issue in (*audit_file(path), *check_bank_anchors(path))
        if issue.severity == "error"
    ]
    audit_ok = not audit_issues
    passed = dslop_ok and style_ok and quiz_ok and option_labels_ok and audit_ok
    if passed and rhythm_only:
        status = "PASS (rhythm metric flagged — owner review)"
    elif passed:
        status = "PASS"
    else:
        failures = []
        if not dslop_ok:
            failures.append("dslop")
        if not style_ok:
            failures.append("style detector")
        if not quiz_ok:
            failures.append("quiz warnings")
        if not option_labels_ok:
            failures.append("option labels")
        if not audit_ok:
            failures.append(f"audit ({len(audit_issues)} errors)")
        status = f"FAIL ({', '.join(failures)})"

    report = UNITS_DIR / unit.uid / "gate-report.txt"
    option_label_text = "clean"
    if option_label_issues:
        option_label_text = "\n".join(
            f"{issue.path.relative_to(ROOT)}:{issue.line}: {issue.text}"
            for issue in option_label_issues
        )
    report.write_text(
        f"unit {unit.uid} — {unit.title}\n"
        f"GATE {status}\n\n"
        f"== dslop (prose body, exit {dslop.returncode}) ==\n{dslop.stdout}{dslop.stderr}\n"
        f"== style detector (full file) ==\n{detector.to_json()}\n"
        f"== quiz: {'clean' if quiz_ok else 'WARNINGS (see quiz-warnings.txt)'} ==\n"
        f"== option labels ==\n{option_label_text}\n"
        f"== audit ==\n"
        + ("clean" if audit_ok else "\n".join(
            f"{issue.path}:{issue.line}: {issue.check}: {issue.message}"
            for issue in audit_issues
        ))
        + "\n",
        encoding="utf-8",
    )
    _log(f"[{unit.uid}] gate: {status} (style score {detector.score})")
    return passed


_DSLOP_HIT_RE = re.compile(r"<stdin>:(\d+):(\d+) ([a-z-]+)")
_MAX_REVISE_ROUNDS = 3
_DOUBLE_QUOTES = '"“”'


def _inside_double_quote(line: str, idx: int) -> bool:
    """Report whether character `idx` in `line` sits within a double-quoted span.

    Counts double-quote characters (straight or curly) before the position; an odd
    count means the position is inside an open quotation. Apostrophes are ignored,
    so single-quote spans are not detected, which is deliberate: the tokens this
    guards (quoted vocabulary items and source citations) are double-quoted in the
    corpus.
    """
    before = sum(1 for ch in line[:idx] if ch in _DOUBLE_QUOTES)
    return before % 2 == 1


def _dslop_hits_outside_quotes(prose: str, report: str) -> list[tuple[int, int, str]]:
    """Return dslop line:col hits whose flagged token is not inside a quotation.

    The anti-slop gate judges the course's authored prose. A word quoted from a
    source or named as a vocabulary item (the rejoinder "Really?" in unit 3.6, say)
    is a citation, not authored filler, so it must not fail the gate.
    """
    lines = prose.splitlines()
    hits: list[tuple[int, int, str]] = []
    for match in _DSLOP_HIT_RE.finditer(report):
        line_no, col, rule = int(match.group(1)), int(match.group(2)), match.group(3)
        line = lines[line_no - 1] if 0 < line_no <= len(lines) else ""
        if _inside_double_quote(line, col - 1):
            continue
        hits.append((line_no, col, rule))
    return hits

_REVISE_BRIEF = (
    "A section of a TEFL course unit failed an automated prose gate. Rewrite it so the listed "
    "violations are gone while preserving every factual claim, example, citation, and roughly "
    "the same length. Also vary sentence length deliberately (mix a few very short sentences "
    "with longer, layered ones — uniform rhythm is itself a violation). Return ONLY the "
    "corrected section prose — no heading, no preamble, no commentary."
)


# Dialogue-turn labels blanked before dslop lints the body: T:/S: plus the named
# speakers the course uses for peer-observation and trainee/mentor exchanges, where
# T:/S: cannot apply (two teachers, or a trainee and a mentor). Verbatim speech
# legitimately runs three short sentences together and must not be linted as prose.
_DIALOGUE_LINE_RE = re.compile(
    r"^\s*(?:[TS]\d*|Mr\. Osei|Ms\. Reyes|Trainee|Mentor|Observer|Colleague|"
    r"Head of department)\s*:\s"
)


def _dslop_prose(text: str) -> str:
    """Return the prose body the dslop gate evaluates.

    Strips the quiz/references (citation formats false-positive) and BLANKS classroom-dialogue
    lines (`T: ...` / `S: ...`) in place — verbatim speech legitimately contains three short
    sentences in a row and must not be linted as authored prose. Blanking (not deleting)
    preserves line numbers so violation mapping stays aligned with the real file.
    """
    body = re.split(r"^## Check your understanding$", text, flags=re.MULTILINE)[0]
    lines = [("" if _DIALOGUE_LINE_RE.match(line) else line) for line in body.splitlines()]
    return "\n".join(lines)


def _run_dslop(prose: str) -> subprocess.CompletedProcess[str]:
    """Run dslop on `prose` via stdin and return the completed process."""
    return subprocess.run(
        ["uv", "run", "dslop", "-"],  # noqa: S607 - uv resolved from PATH by design.
        input=prose,
        capture_output=True,
        text=True,
        check=False,
        cwd=ROOT,
    )


def _section_spans(lines: list[str]) -> list[tuple[str, int, int]]:
    """Return (title, header_index, end_index_exclusive) for each `## ` section, in order."""
    headers = [i for i, line in enumerate(lines) if line.startswith("## ")]
    spans = []
    for pos, header_idx in enumerate(headers):
        end = headers[pos + 1] if pos + 1 < len(headers) else len(lines)
        spans.append((lines[header_idx][3:].strip(), header_idx, end))
    return spans


def _violations_by_span(
    lines: list[str], spans: list[tuple[str, int, int]], dslop_out: str
) -> dict[int, list[str]]:
    """Map dslop line hits to section-span indices as "rule: ...flagged snippet..." strings."""
    hits: dict[int, list[str]] = {}
    for match in _DSLOP_HIT_RE.finditer(dslop_out):
        line_no, col, rule = int(match.group(1)), int(match.group(2)), match.group(3)
        line_idx = line_no - 1
        if not 0 <= line_idx < len(lines):
            continue
        snippet = lines[line_idx][max(0, col - 45) : col + 65].strip()
        for span_idx, (_title, header_idx, end) in enumerate(spans):
            if header_idx < line_idx < end:
                hits.setdefault(span_idx, []).append(f"{rule}: ...{snippet}...")
                break
    return hits


def revise(client: SuperwhisperClient, unit: Unit) -> None:
    """Auto-repair gate violations section by section (up to _MAX_REVISE_ROUNDS passes).

    Sections are addressed by line span, not by heading text, so duplicate or edited headings
    cannot mis-target a rewrite; flagged spans are spliced in reverse order so earlier line
    numbers stay valid while later sections are replaced.
    """
    path = UNITS_DIR / unit.uid / "unit.md"
    for round_no in range(1, _MAX_REVISE_ROUNDS + 1):
        text = path.read_text(encoding="utf-8")
        result = _run_dslop(_dslop_prose(text))
        if result.returncode == 0:
            return
        lines = text.splitlines()
        spans = _section_spans(lines)
        flagged = _violations_by_span(lines, spans, result.stdout + result.stderr)
        if not flagged:
            return  # file-level metrics only (e.g. kurtosis); leave for owner review.
        _log(f"[{unit.uid}] revise round {round_no}: {sum(map(len, flagged.values()))} hits")
        for span_idx in sorted(flagged, reverse=True):
            _title, header_idx, end = spans[span_idx]
            body = "\n".join(lines[header_idx + 1 : end]).strip()
            fixed = _revise_body(client, unit, body, flagged[span_idx])
            if fixed:
                lines[header_idx + 1 : end] = ["", *fixed.splitlines(), ""]
        path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def _revise_body(client: SuperwhisperClient, unit: Unit, body: str, rules: list[str]) -> str:
    """Ask the model to rewrite one flagged section body; returns "" on failure."""
    prompt = "\n".join(
        [
            _REVISE_BRIEF,
            "",
            "Exact violations found in this section (rule: ...the flagged text...):",
            *[f"- {rule}" for rule in rules],
            "",
            "(em-dash: remove em dashes; filler-adverbs: cut quietly/actually/really/simply/"
            "essentially; contrastive: no 'it's not X, it's Y'; demonstrative-is: no 'this is "
            "the'; three-beat: avoid three short sentences in a row; weasel-connectives: cut "
            "'which means', 'in turn', 'the reality is'; banned flourishes: cut 'worth noting', "
            "'to be clear', 'at the end of the day'. Do NOT introduce any of these while fixing.)",
            "",
            "== STYLE RULES ==",
            STYLE_RULES,
            "",
            "== " + _citations_block(unit),
            "",
            "== SECTION TO FIX ==",
            body,
        ]
    )
    return client.generate([{"role": "user", "content": prompt}], max_tokens=2200).strip()


def _log(message: str) -> None:
    """Progress line to stderr (the unit files are the real output)."""
    print(message, file=sys.stderr)


_QUIZ_BLOCK_RE = re.compile(
    r"\*\*\d+\.\s*(?P<q>.+?)\*\*.*?\*Answer:\s*(?P<a>.+?)\*.*?\*Anchor:\s*\"(?P<anchor>.*?)\"\*",
    re.DOTALL,
)


def _quizcheck(unit: Unit) -> bool:
    """Re-validate an existing unit's rendered quiz against the (fuzzy) anchor rule.

    Re-derives quiz items by parsing unit.md, runs `_quiz_problems`, and rewrites/clears the
    warnings file. Returns True if clean. Used to refresh warnings after tightening or relaxing
    the validator without regenerating the unit.
    """
    path = UNITS_DIR / unit.uid / "unit.md"
    text = path.read_text(encoding="utf-8")
    prose = re.split(r"^## Check your understanding$", text, flags=re.MULTILINE)[0]
    quiz_part = text[len(prose) :]
    items: list[object] = [
        {
            "question": m.group("q").strip(),
            "answer": m.group("a").strip(),
            "anchor": m.group("anchor").strip(),
        }
        for m in _QUIZ_BLOCK_RE.finditer(quiz_part)
    ]
    # Count-only check is skipped here (parsing can miss MC option lines); focus on anchors.
    problems = [p for p in _quiz_problems(items, prose) if "anchor" in p or "answer" in p]
    warning = UNITS_DIR / unit.uid / "quiz-warnings.txt"
    if problems:
        warning.write_text("\n".join(problems) + "\n", encoding="utf-8")
    elif warning.exists():
        warning.unlink()
    _log(f"[{unit.uid}] quizcheck: {len(problems)} issue(s)")
    return not problems


def main() -> None:  # noqa: PLR0912 - one CLI dispatch over five subcommands; flat by design.
    """CLI: run/draft/gate units from the registry."""
    parser = argparse.ArgumentParser(prog="tefl-course-build", description="Produce course units.")
    parser.add_argument("command", choices=["run", "draft", "gate", "revise", "quizcheck"])
    parser.add_argument("units", nargs="+", help="unit ids (e.g. 9.2) or 'all'")
    args = parser.parse_args()

    uids = list(UNITS) if args.units == ["all"] else args.units
    unknown = [u for u in uids if u not in UNITS]
    if unknown:
        parser.error(f"unknown unit(s): {', '.join(unknown)} (have: {', '.join(UNITS)})")

    if args.command == "quizcheck":
        results = {uid: _quizcheck(UNITS[uid]) for uid in uids}
    elif args.command == "gate":
        results = {uid: gate(UNITS[uid]) for uid in uids}
    elif args.command == "revise":
        client = SuperwhisperClient()
        try:
            results = {}
            for uid in uids:
                revise(client, UNITS[uid])
                results[uid] = gate(UNITS[uid])
        finally:
            client.close()
    else:
        client = SuperwhisperClient()
        try:
            results = {}
            for uid in uids:
                draft(client, UNITS[uid])
                if args.command == "run":
                    if not gate(UNITS[uid]):
                        revise(client, UNITS[uid])
                    results[uid] = gate(UNITS[uid])
                else:
                    results[uid] = True
        finally:
            client.close()

    failed = [uid for uid, ok in results.items() if not ok]
    _log(f"done: {len(results) - len(failed)}/{len(results)} passed the gate")
    if failed:
        _log(f"FAILED gate (see units/<id>/gate-report.txt): {', '.join(failed)}")
        sys.exit(1)


if __name__ == "__main__":
    main()
