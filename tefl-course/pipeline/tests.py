"""Build module tests and the final exam from per-unit question banks.

Design (decided 2026-06-09 against the available benchmarks — teacherrecord's per-unit recall
MCQs, and the Las Vegas program's real exams, which mix item types and end in a weighted
constructed response):

1. BANK. For every unit, generate 4 fresh questions (3 multiple-choice + 1 short-answer) that are
   DISTINCT from the unit's in-unit quiz, each with a verbatim-or-grounded anchor validated by the
   same rules as unit quizzes (`build._quiz_problems`). Cached at units/<uid>/bank.json.
2. MODULE TESTS (one per module). Sections: A) this module's material, 3 bank questions per unit
   (1 point each); B) review, 2 questions re-asked verbatim from EARLIER modules' unit quizzes —
   re-testing identical items is deliberate spaced retrieval (Karpicke & Roediger, 2008; Kim &
   Webb, 2022), the design the course itself teaches; C) one scenario question (5 points).
3. FINAL EXAM. The reserved 4th bank question from every unit (~1 per unit across all modules),
   plus 3 cross-module scenario questions (10 points each). Pass mark 70%, stated on the paper.

Run from the repo root:

    uv run python tefl-course/pipeline/tests.py bank all     # build/refresh question banks
    uv run python tefl-course/pipeline/tests.py assemble     # write module tests + final exam
"""

from __future__ import annotations

import argparse
import json
import random
import re
import sys
from pathlib import Path
from typing import cast

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build  # ty: ignore[unresolved-import]
from registry import UNITS, Unit  # ty: ignore[unresolved-import]

from jobkit.llm import SuperwhisperClient

ROOT = Path(__file__).resolve().parents[1]
TESTS_DIR = ROOT / "tests"

PASS_MARK = "70%"  # noqa: S105 - an exam pass mark, not a credential.
REVIEW_PER_TEST = 2
BANK_PER_UNIT = 4  # 3 go to the module test, the 4th is reserved for the final exam.

# Module number -> title, taken from the registry's module strings.
MODULE_TITLES: dict[int, str] = {}
for _u in UNITS.values():
    _m = re.match(r"M(\d+)\s*—\s*(.+)", _u.module)
    if _m:
        MODULE_TITLES[int(_m.group(1))] = _m.group(2).strip()


def _module_of(uid: str) -> int:
    """Return the module number for a unit id ("9.2" -> 9)."""
    return int(uid.split(".", 1)[0])


def _units_of(module: int) -> list[Unit]:
    """Units of a module in uid order."""
    return sorted(
        (u for u in UNITS.values() if _module_of(u.uid) == module),
        key=lambda u: [int(p) for p in u.uid.split(".")],
    )


_BANK_BRIEF = (
    "Write exactly 4 NEW quiz questions for the course unit below: 3 multiple-choice (4 options, "
    "one correct) and 1 short-answer. The unit already has a quiz (shown below) — your questions "
    "must test DIFFERENT points or angles from those, not rephrase them. For EVERY question "
    "include an 'anchor': a verbatim quote of at most 15 words from the unit text containing the "
    'answer. Return ONLY {"questions": [{"type": "mc"|"short", "question": "...", "options": '
    '[...] or null, "answer": "...", "anchor": "..."}]}.'
)

_SCENARIO_BRIEF = (
    "Write ONE scenario question for a module test in a TEFL certificate course. Describe a "
    "specific classroom situation (use only the course cast: learners Carlos, Daniel, Wei, "
    "Fatima, Yuki, Priya; teachers Ms. Reyes, Mr. Osei) that requires applying ideas from the "
    "module summarized below, then ask the trainee what they would do and why. Provide a model "
    "answer grounded in the module content. Return ONLY "
    '{"question": "...", "answer": "...", "anchor": "<verbatim quote of <=15 words from the '
    'material that the answer rests on>"}.'
)


def _unit_text(unit: Unit) -> tuple[str, str]:
    """Return (prose_body, quiz_part) of a built unit."""
    text = (build.UNITS_DIR / unit.uid / "unit.md").read_text(encoding="utf-8")
    prose = re.split(r"^## Check your understanding$", text, flags=re.MULTILINE)[0]
    return prose, text[len(prose) :]


def build_bank(client: SuperwhisperClient, unit: Unit) -> list[dict[str, object]]:
    """Generate (or load) the unit's 4-question test bank, validated like unit quizzes."""
    cache = build.UNITS_DIR / unit.uid / "bank.json"
    if cache.exists():
        return cast("list[dict[str, object]]", json.loads(cache.read_text(encoding="utf-8")))
    prose, quiz = _unit_text(unit)
    prompt = (
        f"{_BANK_BRIEF}\n\n== THE UNIT ==\n{prose}\n\n== ITS EXISTING QUIZ (do not repeat) ==\n"
        f"{quiz}"
    )
    items: list[dict[str, object]] = []
    problems = ["never ran"]
    for _attempt in range(3):
        parsed = build._json_call(client, prompt, max_tokens=1800)  # noqa: SLF001
        fields = cast("dict[str, object]", parsed) if isinstance(parsed, dict) else {}
        raw = fields.get("questions", [])
        items = (
            [cast("dict[str, object]", q) for q in raw if isinstance(q, dict)]
            if isinstance(raw, list)
            else []
        )
        problems = _bank_problems(items, prose)
        if not problems:
            break
        build._log(f"[{unit.uid}] bank failed validation ({len(problems)}); retrying")  # noqa: SLF001
    if problems:
        msg = f"unit {unit.uid}: bank still invalid after retries: {problems[:3]}"
        raise RuntimeError(msg)
    cache.write_text(json.dumps(items, indent=2, ensure_ascii=False), encoding="utf-8")
    return items


def _bank_problems(items: list[dict[str, object]], prose: str) -> list[str]:
    """Validate a bank: 4 questions, 3 MC with 4 options, anchors grounded in the unit prose."""
    problems: list[str] = []
    if len(items) != BANK_PER_UNIT:
        problems.append(f"expected {BANK_PER_UNIT} questions, got {len(items)}")
    lowered = prose.lower()
    unit_words = frozenset(re.findall(r"[a-z0-9]+", lowered))
    mc = 0
    for i, q in enumerate(items, 1):
        options = q.get("options")
        if isinstance(options, list):
            mc += 1
            if len(options) != 4:  # noqa: PLR2004 - MC convention.
                problems.append(f"q{i}: needs 4 options, got {len(options)}")
        if not str(q.get("question", "")).strip() or not str(q.get("answer", "")).strip():
            problems.append(f"q{i}: empty question/answer")
        anchor = str(q.get("anchor", "")).strip()
        if not anchor:
            problems.append(f"q{i}: missing anchor")
        elif anchor.lower() not in lowered and not build._anchor_grounded(  # noqa: SLF001
            anchor, unit_words
        ):
            problems.append(f"q{i}: anchor not grounded: {anchor!r}")
    if mc != 3:  # noqa: PLR2004 - 3 MC + 1 short by design.
        problems.append(f"expected 3 multiple-choice, got {mc}")
    return problems


_REVIEW_MAX_LEN = 220  # skip long scenario stems; review items should be quick re-asks.


def _review_pool(before_module: int) -> list[tuple[str, dict[str, object]]]:
    """Collect (uid, question) pairs from the UNIT QUIZZES of all modules before `before_module`."""
    pool: list[tuple[str, dict[str, object]]] = []
    for unit in UNITS.values():
        if _module_of(unit.uid) >= before_module:
            continue
        _prose, quiz = _unit_text(unit)
        for m in build._QUIZ_BLOCK_RE.finditer(quiz):  # noqa: SLF001
            q = m.group("q").strip()
            # Only re-ask self-contained questions; skip scenario items (too long to re-ask).
            if len(q) < _REVIEW_MAX_LEN:
                pool.append((unit.uid, {"question": q, "answer": m.group("a").strip()}))
    return pool


def _scenario(client: SuperwhisperClient, label: str, material: str) -> dict[str, object]:
    """Generate one validated scenario question against `material`."""
    prompt = f"{_SCENARIO_BRIEF}\n\n== MODULE: {label} ==\n{material}"
    for _attempt in range(3):
        parsed = build._json_call(client, prompt, max_tokens=1200)  # noqa: SLF001
        if isinstance(parsed, dict) and str(parsed.get("question", "")).strip():
            return cast("dict[str, object]", parsed)
    msg = f"scenario generation failed for {label}"
    raise RuntimeError(msg)


def _render_mc(i: int, q: dict[str, object]) -> str:
    """Render one bank/test question as markdown (with answer-key block)."""
    lines = [f"**{i}. {q.get('question', '')}**", ""]
    options = q.get("options")
    if isinstance(options, list):
        lines += [f"   {chr(96 + j)}. {opt}" for j, opt in enumerate(options, 1)]
        lines.append("")
    lines.append(f"   *Answer: {q.get('answer', '')}*")
    anchor = str(q.get("anchor", "")).strip()
    if anchor:
        lines.append(f'   *Anchor: "{anchor}"*')
    lines.append("")
    return "\n".join(lines)


def assemble_module_test(module: int, rng: random.Random) -> str:
    """Assemble one module test from cached banks + spaced-review pool."""
    units = _units_of(module)
    title = MODULE_TITLES.get(module, f"Module {module}")
    n_module_qs = 3 * len(units)
    pool = _review_pool(module)
    reviews = rng.sample(pool, k=min(REVIEW_PER_TEST, len(pool))) if pool else []
    total_points = n_module_qs + len(reviews) + 5

    out = [
        f"# Module {module} Test — {title}",
        "",
        f"Covers units {units[0].uid} to {units[-1].uid}. {total_points} points total; "
        f"pass mark {PASS_MARK}."
        + (
            " Section B re-asks questions from earlier modules: retrieving material again "
            "after a delay is part of how this course makes it stick."
            if reviews
            else ""
        ),
        "",
        f"## Section A — This module ({n_module_qs} points, 1 each)",
        "",
    ]
    i = 0
    for unit in units:
        bank = json.loads((build.UNITS_DIR / unit.uid / "bank.json").read_text(encoding="utf-8"))
        for q in bank[:3]:
            i += 1
            out.append(_render_mc(i, q))
    if reviews:
        out += [f"## Section B — Review ({len(reviews)} points, 1 each)", ""]
        for uid, q in reviews:
            i += 1
            out.append(_render_mc(i, {**q, "anchor": f"unit {uid} quiz"}))
    scen = json.loads((TESTS_DIR / f"_scenario-M{module}.json").read_text(encoding="utf-8"))
    out += ["## Section C — Scenario (5 points)", "", _render_mc(i + 1, scen)]
    return "\n".join(out) + "\n"


def assemble_final() -> str:
    """Assemble the final exam: every unit's reserved bank question + 3 scenario essays."""
    uids = sorted(UNITS, key=lambda u: [int(p) for p in u.split(".")])
    out = [
        "# Final Exam",
        "",
        f"Comprehensive: one question from every unit of the course, plus three scenario "
        f"questions. {len(uids) + 30} points total ({len(uids)} + 3 x 10); pass mark {PASS_MARK}.",
        "",
        f"## Section A — Course content ({len(uids)} points, 1 each)",
        "",
    ]
    current_module = 0
    for i, uid in enumerate(uids, 1):
        module = _module_of(uid)
        if module != current_module:
            current_module = module
            out.append(f"### Module {module} — {MODULE_TITLES.get(module, '')}\n")
        bank = json.loads((build.UNITS_DIR / uid / "bank.json").read_text(encoding="utf-8"))
        out.append(_render_mc(i, bank[3]))  # the reserved 4th question
    out += ["## Section B — Scenarios (30 points, 10 each)", ""]
    for j in range(1, 4):
        scen = json.loads((TESTS_DIR / f"_scenario-final-{j}.json").read_text(encoding="utf-8"))
        out.append(_render_mc(len(uids) + j, scen))
    return "\n".join(out) + "\n"


def cmd_bank(uids: list[str]) -> None:
    """Build question banks for the given units (or all)."""
    client = SuperwhisperClient()
    try:
        for uid in uids:
            build_bank(client, UNITS[uid])
            build._log(f"[{uid}] bank ok")  # noqa: SLF001
    finally:
        client.close()


def cmd_scenarios() -> None:
    """Generate the per-module and final-exam scenario questions (cached as JSON)."""
    TESTS_DIR.mkdir(exist_ok=True)
    client = SuperwhisperClient()
    try:
        for module in sorted(MODULE_TITLES):
            cache = TESTS_DIR / f"_scenario-M{module}.json"
            if cache.exists():
                continue
            material = "\n\n".join(_unit_text(u)[0][:4000] for u in _units_of(module))
            scen = _scenario(client, MODULE_TITLES[module], material)
            cache.write_text(json.dumps(scen, indent=2, ensure_ascii=False), encoding="utf-8")
            build._log(f"[M{module}] scenario ok")  # noqa: SLF001
        spans = [
            (1, 5, "foundations, grammar, and methods"),
            (5, 10, "vocabulary, skills, and feedback"),
            (10, 15, "planning, management, learners, and assessment"),
        ]
        for j, (lo, hi, label) in enumerate(spans, 1):
            cache = TESTS_DIR / f"_scenario-final-{j}.json"
            if cache.exists():
                continue
            mods = [m for m in sorted(MODULE_TITLES) if lo <= m < hi]
            material = "\n\n".join(
                _unit_text(_units_of(m)[0])[0][:2500] for m in mods if _units_of(m)
            )
            scen = _scenario(client, f"modules {lo}-{hi - 1} ({label})", material)
            cache.write_text(json.dumps(scen, indent=2, ensure_ascii=False), encoding="utf-8")
            build._log(f"[final-{j}] scenario ok")  # noqa: SLF001
    finally:
        client.close()


def cmd_assemble() -> None:
    """Write all module tests and the final exam."""
    TESTS_DIR.mkdir(exist_ok=True)
    rng = random.Random(20260609)  # noqa: S311 - reproducible sampling, not crypto.
    for module in sorted(MODULE_TITLES):
        path = TESTS_DIR / f"module-{module:02d}-test.md"
        path.write_text(assemble_module_test(module, rng), encoding="utf-8")
        build._log(f"wrote {path.name}")  # noqa: SLF001
    (TESTS_DIR / "final-exam.md").write_text(assemble_final(), encoding="utf-8")
    build._log("wrote final-exam.md")  # noqa: SLF001


def main() -> None:
    """CLI: bank / scenarios / assemble."""
    parser = argparse.ArgumentParser(prog="tests.py", description="Build module tests + final.")
    parser.add_argument("command", choices=["bank", "scenarios", "assemble"])
    parser.add_argument("units", nargs="*", help="unit ids or 'all' (bank only)")
    args = parser.parse_args()
    if args.command == "bank":
        uids = list(UNITS) if args.units in ([], ["all"]) else args.units
        cmd_bank(uids)
    elif args.command == "scenarios":
        cmd_scenarios()
    else:
        cmd_assemble()


if __name__ == "__main__":
    main()
