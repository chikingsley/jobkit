"""Build resume markdown files into PDFs.

Uses pypandoc (bundled pandoc from ``pypandoc-binary``) to render markdown into a
standalone HTML with the packaged template/CSS, with pandoc invoking weasyprint as
the PDF engine. Both pandoc and weasyprint come from the uv environment, so nothing
is installed globally.

Exposed as the ``build-resume`` console script (see ``[project.scripts]``)::

    uv run build-resume pm           # alias -> project-management-resume
    uv run build-resume --all        # every resume in resumes/
    uv run build-resume master-resume teaching-resume
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import pypandoc

ASSETS = Path(__file__).parent / "assets"
TEMPLATE = ASSETS / "resume-template.html"
CSS = ASSETS / "resume-pdf.css"

# Short aliases -> resume stem (file name without .md).
ALIASES = {
    "biotech": "biotech-resume",
    "master": "master-resume",
    "pm": "project-management-resume",
    "service": "service-resume",
    "teaching": "teaching-resume",
}


def find_project_root(start: Path | None = None) -> Path:
    """Walk up from ``start`` (default cwd) to the dir that holds ``resumes/``."""
    here = (start or Path.cwd()).resolve()
    for candidate in (here, *here.parents):
        if (candidate / "resumes").is_dir():
            return candidate
    return here


def resume_stems(root: Path) -> list[str]:
    """Return the available resume stems under ``root``."""
    return sorted(p.stem for p in (root / "resumes").glob("*.md"))


def build(name: str, root: Path) -> Path:
    """Build one resume and return the generated PDF path."""
    stem = ALIASES.get(name, name)
    src = root / "resumes" / f"{stem}.md"
    if not src.exists():
        available = ", ".join(resume_stems(root)) or "(none)"
        sys.exit(f"build-resume: no resume {src.relative_to(root)} (available: {available})")
    out_dir = root / "resumes" / "pdfs"
    out_dir.mkdir(parents=True, exist_ok=True)
    dest = out_dir / f"{stem}.pdf"
    pypandoc.convert_file(
        str(src),
        to="pdf",
        format="markdown",
        outputfile=str(dest),
        extra_args=[
            "--standalone",
            f"--template={TEMPLATE}",
            f"--css={CSS}",
            "--pdf-engine=weasyprint",
        ],
    )
    print(f"built {dest.relative_to(root)}")
    return dest


def main() -> None:
    """Run the build-resume command-line interface."""
    parser = argparse.ArgumentParser(prog="build-resume", description=__doc__)
    parser.add_argument("names", nargs="*", help="resume stems or aliases (master, pm, teaching)")
    parser.add_argument("--all", action="store_true", help="build every resume in resumes/")
    parser.add_argument("--list", action="store_true", help="list available resumes and exit")
    args = parser.parse_args()

    root = find_project_root()

    if args.list:
        print("\n".join(resume_stems(root)))
        return

    names = resume_stems(root) if args.all else args.names
    if not names:
        parser.error("give resume names, an alias, or --all (use --list to see options)")
    for name in names:
        build(name, root)


if __name__ == "__main__":
    main()
