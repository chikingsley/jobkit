"""Produce course units: outline -> draft -> gate, per the pipeline design.

Usage (from the repo root):

    uv run python tefl-course/pipeline/build.py run 9.2 9.3      # build + gate specific units
    uv run python tefl-course/pipeline/build.py run all          # build + gate every Wave 1 unit
    uv run python tefl-course/pipeline/build.py gate 9.2         # re-gate an existing draft

Per unit: an outline call proposes 4-6 sections from the source text and scope; the draft stage
writes each section with the style rules and (only) the registry's citation facts embedded; the
gate runs dslop on the prose body (quiz/references stripped — citation format false-positives) and
the vendored patterns.js scorer on the whole file, writing `gate-report.txt` next to the unit.
Output: tefl-course/units/<uid>/unit.md. The model never sees teacherrecord text.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path
from typing import cast

from jobkit.llm import SuperwhisperClient

sys.path.insert(0, str(Path(__file__).resolve().parent))
from registry import TEXT_DIR, UNITS, Unit  # ty: ignore[unresolved-import]

ROOT = Path(__file__).resolve().parents[1]  # tefl-course/
UNITS_DIR = ROOT / "units"
STYLE_RULES = (ROOT / "pilot" / "style-rules.md").read_text(encoding="utf-8")

PATTERNS_JS = ROOT.parent / ".claude" / "skills" / "avoid-ai-writing" / "detector" / "patterns.js"
PATTERNS_MAX_SCORE = 20

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


def _load_sources(unit: Unit) -> str:
    """Concatenate the unit's extracted source text files."""
    parts = [(ROOT / TEXT_DIR / name).read_text(encoding="utf-8") for name in unit.sources]
    return "\n\n".join(parts)


def _citations_block(unit: Unit) -> str:
    """Render the allowed-citations constraint for the prompts."""
    if not unit.citation_facts:
        return (
            "This unit has NO research citations. Make no claims about research, studies, or "
            "evidence. Every claim must come from the source text."
        )
    return (
        "Verified research facts (the ONLY effectiveness claims you may make; cite inline as "
        f"(Author, Year)):\n{unit.citation_facts}\nDo not invent, extend, or round these. Every "
        "other claim must come from the source text."
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
            "== SOURCE TEXT ==",
            _load_sources(unit),
        ]
    )
    parsed = client.generate_json([{"role": "user", "content": prompt}], max_tokens=1400)
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
        "words, in the register required by the style rules. Return ONLY a JSON object "
        '{"text": "..."} with the section prose (no heading).',
        "",
        "== STYLE RULES (violations are rejected by an automated gate) ==",
        STYLE_RULES,
        "",
        "== " + _citations_block(unit),
        "",
        "== SOURCE TEXT (public domain — the unit's factual basis) ==",
        source,
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
        parsed = client.generate_json(
            [{"role": "user", "content": prompt}], max_tokens=int(words * 2.2)
        )
        fields = cast("dict[str, object]", parsed) if isinstance(parsed, dict) else {}
        text = str(fields.get("text", "")).strip()
        if not text:
            sys.exit(f"unit {unit.uid}: empty draft for section {sec.get('title')!r}")
        chunks.append(f"\n## {sec.get('title', '')}\n\n{text}\n")
        previous_tail = text[-600:]
        _log(f"[{unit.uid}] drafted: {sec.get('title')} ({len(text.split())} words)")

    quiz_prompt = (
        f"{_QUIZ_BRIEF}\n\n== STYLE RULES ==\n{STYLE_RULES}\n\n== THE UNIT ==\n" + "\n".join(chunks)
    )
    parsed = client.generate_json([{"role": "user", "content": quiz_prompt}], max_tokens=1600)
    fields = cast("dict[str, object]", parsed) if isinstance(parsed, dict) else {}
    raw_questions = fields.get("questions", [])
    items = cast("list[object]", raw_questions) if isinstance(raw_questions, list) else []
    chunks.append(_render_quiz(items))
    chunks.append("\n## References\n\n" + "\n".join(f"- {r}" for r in unit.references) + "\n")

    out = UNITS_DIR / unit.uid / "unit.md"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("\n".join(chunks), encoding="utf-8")
    _log(f"[{unit.uid}] wrote {out}")
    return out


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
            lines += [f"   {chr(96 + j)}. {opt}" for j, opt in enumerate(options, 1)]
            lines.append("")
        lines.append(f"   *Answer: {q.get('answer', '')}*")
        lines.append(f'   *Anchor: "{q.get("anchor", "")}"*\n')
    return "\n".join(lines)


def gate(unit: Unit) -> bool:
    """Run the deterministic gate on a drafted unit; write gate-report.txt; return pass/fail."""
    path = UNITS_DIR / unit.uid / "unit.md"
    text = path.read_text(encoding="utf-8")
    dslop = _run_dslop(_dslop_prose(text))
    detector = subprocess.run(  # noqa: S603 - fixed argv, vendored script.
        ["node", "-e", _DETECTOR_JS, str(path)],  # noqa: S607 - node from PATH by design.
        capture_output=True,
        text=True,
        check=False,
        cwd=ROOT.parent,
    )
    score = _detector_score(detector.stdout)
    # The sentence-length-kurtosis metric is an OPEN OWNER DECISION (see the pilot): dialogue-
    # heavy teaching prose legitimately depresses it. A unit whose only dslop finding is that
    # file-level metric passes the gate with a rhythm flag rather than failing outright.
    rhythm_only = dslop.returncode != 0 and not _DSLOP_HIT_RE.search(dslop.stdout)
    patterns_ok = score is not None and score < PATTERNS_MAX_SCORE
    passed = (dslop.returncode == 0 or rhythm_only) and patterns_ok
    status = "PASS"
    if not passed:
        status = "FAIL"
    elif rhythm_only:
        status = "PASS (rhythm metric flagged — owner review)"

    report = UNITS_DIR / unit.uid / "gate-report.txt"
    report.write_text(
        f"unit {unit.uid} — {unit.title}\n"
        f"GATE {status}\n\n"
        f"== dslop (prose body, exit {dslop.returncode}) ==\n{dslop.stdout}{dslop.stderr}\n"
        f"== patterns.js (full file) ==\n{detector.stdout}{detector.stderr}\n",
        encoding="utf-8",
    )
    _log(f"[{unit.uid}] gate: {status} (patterns score {score})")
    return passed


_DETECTOR_JS = (
    'const A = require("./.claude/skills/avoid-ai-writing/detector/patterns.js");'
    'const fs = require("fs");'
    "const r = A.analyzeText(fs.readFileSync(process.argv[1], 'utf8'));"
    "console.log(JSON.stringify({score: r.score, label: r.label, issues: r.issues.length}));"
)

_DSLOP_HIT_RE = re.compile(r"<stdin>:(\d+):(\d+) ([a-z-]+)")
_MAX_REVISE_ROUNDS = 3

_REVISE_BRIEF = (
    "A section of a TEFL course unit failed an automated prose gate. Rewrite it so the listed "
    "violations are gone while preserving every factual claim, example, citation, and roughly "
    "the same length. Also vary sentence length deliberately (mix a few very short sentences "
    "with longer, layered ones — uniform rhythm is itself a violation). Return ONLY a JSON "
    'object {"text": "..."} with the corrected section prose (no heading).'
)


def _dslop_prose(text: str) -> str:
    """Return the prose body the dslop gate evaluates (everything before the quiz)."""
    return re.split(r"^## Check your understanding$", text, flags=re.MULTILINE)[0]


def _run_dslop(prose: str) -> subprocess.CompletedProcess[str]:
    """Run dslop on `prose` via stdin and return the completed process."""
    return subprocess.run(
        ["uv", "run", "dslop", "-"],  # noqa: S607 - uv resolved from PATH by design.
        input=prose,
        capture_output=True,
        text=True,
        check=False,
        cwd=ROOT.parent,
    )


def _violations_by_section(text: str, dslop_out: str) -> dict[str, list[str]]:
    """Map dslop violations onto `## ` sections as "rule: ...flagged snippet..." strings."""
    lines = text.splitlines()
    section_for_line: list[str] = []
    current = "(preamble)"
    for line in lines:
        if line.startswith("## "):
            current = line[3:].strip()
        section_for_line.append(current)
    hits: dict[str, list[str]] = {}
    for match in _DSLOP_HIT_RE.finditer(dslop_out):
        line_no, col, rule = int(match.group(1)), int(match.group(2)), match.group(3)
        if not 1 <= line_no <= len(section_for_line):
            continue
        line_text = lines[line_no - 1]
        snippet = line_text[max(0, col - 45) : col + 65].strip()
        hits.setdefault(section_for_line[line_no - 1], []).append(f"{rule}: ...{snippet}...")
    return hits


def revise(client: SuperwhisperClient, unit: Unit) -> None:
    """Auto-repair gate violations section by section (up to _MAX_REVISE_ROUNDS passes)."""
    path = UNITS_DIR / unit.uid / "unit.md"
    for round_no in range(1, _MAX_REVISE_ROUNDS + 1):
        text = path.read_text(encoding="utf-8")
        result = _run_dslop(_dslop_prose(text))
        if result.returncode == 0:
            return
        by_section = _violations_by_section(text, result.stdout)
        flagged = {k: v for k, v in by_section.items() if k != "(preamble)"}
        if not flagged:
            return  # file-level metrics only (e.g. kurtosis); leave for owner review.
        _log(f"[{unit.uid}] revise round {round_no}: {sum(map(len, flagged.values()))} hits")
        for section_title, rules in flagged.items():
            text = _revise_section(client, unit, text, section_title, rules)
        path.write_text(text, encoding="utf-8")


def _revise_section(
    client: SuperwhisperClient, unit: Unit, text: str, section_title: str, rules: list[str]
) -> str:
    """Rewrite one flagged section in `text` and return the updated unit text."""
    pattern = re.compile(
        rf"(^## {re.escape(section_title)}$\n)(.*?)(?=^## |\Z)", re.MULTILINE | re.DOTALL
    )
    match = pattern.search(text)
    if match is None:
        return text
    body = match.group(2).strip()
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
    parsed = client.generate_json([{"role": "user", "content": prompt}], max_tokens=2200)
    fields = cast("dict[str, object]", parsed) if isinstance(parsed, dict) else {}
    fixed = str(fields.get("text", "")).strip()
    if not fixed:
        return text
    return text[: match.start(2)] + fixed + "\n\n" + text[match.end(2) :]


def _detector_score(stdout: str) -> int | None:
    """Parse the patterns.js score from the helper's JSON line."""
    try:
        parsed = json.loads(stdout.strip().splitlines()[-1])
    except (json.JSONDecodeError, IndexError):
        return None
    if isinstance(parsed, dict):
        score = cast("dict[str, object]", parsed).get("score")
        if isinstance(score, int):
            return score
    return None


def _log(message: str) -> None:
    """Progress line to stderr (the unit files are the real output)."""
    print(message, file=sys.stderr)  # noqa: T201


def main() -> None:
    """CLI: run/draft/gate units from the registry."""
    parser = argparse.ArgumentParser(prog="build.py", description="Produce course units.")
    parser.add_argument("command", choices=["run", "draft", "gate", "revise"])
    parser.add_argument("units", nargs="+", help="unit ids (e.g. 9.2) or 'all'")
    args = parser.parse_args()

    uids = list(UNITS) if args.units == ["all"] else args.units
    unknown = [u for u in uids if u not in UNITS]
    if unknown:
        parser.error(f"unknown unit(s): {', '.join(unknown)} (have: {', '.join(UNITS)})")

    if args.command == "gate":
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
