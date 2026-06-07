set shell := ["bash", "-cu"]

# Thin wrappers around the `build-resume` console script (pandoc + weasyprint live
# in the uv env — no global installs). Run `uv sync` once after cloning.

# Build one or more resumes by stem or alias (master, pm, teaching).
pdf *names:
    uv run build-resume {{names}}

# Build every resume in resumes/.
all:
    uv run build-resume --all

pm:
    uv run build-resume pm

teaching:
    uv run build-resume teaching

master:
    uv run build-resume master

# Lint + type-check (matches the convention used across the other Python projects).
lint:
    uv run ruff check src
    uv run ruff format --check src

fmt:
    uv run ruff format src
    uv run ruff check --fix src

typecheck:
    uv run ty check
