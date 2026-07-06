# TEFL Course

Standalone uv project for TEFL course generation, assessments, and prose gates.

## Commands

```bash
uv run tefl-course-build gate all
uv run tefl-course-build gate 3.6
uv run tefl-course-assessments assemble
uv run tefl-course-check
uv run tefl-course-detect-style units/3.6/unit.md
```

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
