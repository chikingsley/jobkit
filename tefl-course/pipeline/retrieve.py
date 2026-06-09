"""Keyword retrieval over the public-domain corpus, for partial-coverage (Wave 2) units.

Wave 1 units map to exact State Dept module files. Wave 2 units cover topics scattered across the
204-page companion (*From Observation to Action*) and the activity books, so instead of hand-mapping
sections we score fixed-size text windows by keyword overlap with the unit's retrieval query and
feed
the top windows as that unit's source. Pure stdlib; deterministic; no network.

Corpus = the companion + the State Dept activity books (all public domain). teacherrecord and the
copyrighted textbooks are NEVER in this corpus.
"""

from __future__ import annotations

import re
from functools import lru_cache
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# Public-domain text files that make up the retrieval corpus.
_CORPUS_FILES = (
    "sources/state-dept-shaping/text/shaping_frm_observ_508.txt",
    "sources/state-dept-activities/text/activate-teachers-manual_508.txt",
    "sources/state-dept-activities/text/create-to-communicate_2nd-edition_508.txt",
    "sources/state-dept-activities/text/dialogs-for-everyday-use_508.txt",
)

_WINDOW_WORDS = 450
_STEP_WORDS = 350  # overlap so a topic straddling a boundary still lands in one window
_STOP: frozenset[str] = frozenset(
    (  # noqa: SIM905 - space-joined string beats a 90-item list literal
        "the a an and or but of to in on for with at by from as is are be it this that these those "
        "you your they them their we our he she his her i me my can will would should could may "
        "might do does did not no yes if then than so such into out up down over under more most "
        "some any each which who what when where how why about also one two"
    ).split()
)


@lru_cache(maxsize=1)
def _windows() -> list[tuple[str, str]]:
    """Return (source_name, window_text) tiles across the whole corpus (cached)."""
    tiles: list[tuple[str, str]] = []
    for rel in _CORPUS_FILES:
        path = ROOT / rel
        if not path.exists():
            continue
        words = path.read_text(encoding="utf-8").split()
        name = Path(rel).stem
        for start in range(0, len(words), _STEP_WORDS):
            chunk = words[start : start + _WINDOW_WORDS]
            if len(chunk) < 80:  # noqa: PLR2004 - skip a tail too short to be useful.
                break
            tiles.append((name, " ".join(chunk)))
    return tiles


def _terms(text: str) -> list[str]:
    """Lowercased content words (no stopwords, length >= 3)."""
    return [w for w in re.findall(r"[a-z]+", text.lower()) if len(w) >= 3 and w not in _STOP]  # noqa: PLR2004


def retrieve(query: str, *, top_k: int = 5) -> str:
    """Return the top_k corpus windows most relevant to `query`, concatenated with provenance.

    Scoring is term-frequency overlap: each query term contributes its count in the window. Ties
    keep corpus order (stable). Returns "" if nothing scores above zero.
    """
    q = set(_terms(query))
    if not q:
        return ""
    scored: list[tuple[int, int, str, str]] = []
    for idx, (name, text) in enumerate(_windows()):
        lowered = text.lower()
        score = sum(lowered.count(term) for term in q)
        if score > 0:
            scored.append((score, idx, name, text))
    scored.sort(key=lambda s: (-s[0], s[1]))
    parts = [f"[source: {name}]\n{text}" for _score, _idx, name, text in scored[:top_k]]
    return "\n\n---\n\n".join(parts)
