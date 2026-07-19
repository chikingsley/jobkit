# TEFL Course

Standalone uv project for TEFL course generation, assessments, and prose gates.

## Commands

```bash
uv run tefl-course-build gate all
uv run tefl-course-build gate 3.6
uv run tefl-course-assessments assemble
uv run tefl-course-check
uv run tefl-course-audit                       # truth-level gate (all content)
uv run tefl-course-audit units/3.6/unit.md     # one file
uv run tefl-course-detect-style units/3.6/unit.md
```

## Quality gates

Two layers run over every unit, and both must pass (`tefl-course-build gate` runs them together):

- **Style gate** — `dslop` + the AI-style detector + quiz-format checks. Catches machine-writing
  tics, banned lexicon, and malformed quizzes. Judges authored prose only: quoted vocabulary and
  source citations, and named-speaker dialogue turns, are exempt.
- **Truth gate** — `tefl-course-audit`. Catches what style checks cannot: cast consistency
  (role / age / nationality / pronoun / artifacts / out-of-cast names), verbatim quiz anchors in
  units, `bank.json`, and assessment keys, references hygiene (non-empty, in-text citations
  covered, no leaked filenames), American spelling, MCQ answer-letter balance, and punctuation
  artifacts. Reviewed false positives live in `docs/audit-allowlist.txt`. See
  [docs/review-2026-07-17.md](docs/review-2026-07-17.md) for why this layer exists.

LLM-backed commands require `SUPERWHISPER_API_BASE` and `SUPERWHISPER_API_KEY` in the
environment or a parent `.env`.

## Layout

```text
src/tefl_course/       package code and CLIs
course-intro.md        learner-facing course introduction
docs/                  planning, research, source manifests, and review notes
units/                 generated course units, banks, and gate reports
assessments/           module assessments, final exam, and scenario caches
pilot/                 pilot source files and draft artifact
sources/               source corpus and personal archive material
```
