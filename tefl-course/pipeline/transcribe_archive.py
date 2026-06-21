"""Render the Vegas teaching-archive transcripts: diarized JSONL -> one markdown per audio file.

Pass B of the archive transcription (Pass A is the batch `superwhisper-audio --diarize` run that
produces `transcripts-diarized.jsonl`). For each record this script:

1. folds the word-level diarization into speaker turns (vendored local `turns` helper),
2. derives consistent frontmatter from the archive's folder structure (book, audio name, units,
   duration, speaker count, source path),
3. asks Sonnet 4.6 (via the same proxy) to NAME the speakers from context — "Narrator",
   "Woman 1", "Interviewer" — and give a one-line description of the recording, and
4. writes the markdown ALONGSIDE the audio file (`<same dir>/<track>.md`): frontmatter +
   labelled dialogue (or plain prose for single-speaker tracks).

PERSONAL USE ONLY: these transcripts are derivatives of copyrighted textbook audio the owner uses
for his own lesson preparation. They live inside the gitignored archive dir and are never
published or shipped with the course.

Run from the jobkit environment (it now talks to the deployed HTTP API via ``jobkit.llm``, so it
no longer needs the superwhisper-api package). ``SUPERWHISPER_API_BASE`` + ``SUPERWHISPER_API_KEY``
must be set (env or ``.env``):

    cd ~/github/jobkit && uv run python tefl-course/pipeline/transcribe_archive.py
"""

from __future__ import annotations

import json
import re
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any, cast

from turns import Turn, to_markdown, words_to_turns  # ty: ignore[unresolved-import]

from jobkit.llm import SuperwhisperClient

ARCHIVE = Path("/home/simon/github/jobkit/tefl-course/sources/las-vegas-teaching-archive")
JSONL = ARCHIVE / "transcripts-diarized.jsonl"

MODEL = "claude-sonnet-4-6"

# Folder names that are organizational, not book names.
_SKIP_SEGMENTS = {
    "FACULTY ORIENTATION",
    "FINAL EXAMS- CURRENT",
    "AUDIO- BOOKS",
    "AUDIO-FINAL EXAMS -FACULTY",
    "CURRICULUM- SYLLABI",
    "HANDBOOKS _ MANUALS-FACULTY",
}

_UNITS_RE = re.compile(r"UNITS?\s*(\d+(?:\s*[-\u2013]\s*\d+)?)", re.IGNORECASE)

# Narrators frequently announce the book page ("Page 215. Exercise five..."), so the page number
# can be read straight off the transcript. First announcement wins.
_PAGE_RE = re.compile(r"\bpage\s+(\d{1,3})\b", re.IGNORECASE)

_LABEL_BRIEF = (
    "You are labelling a diarized transcript of ESL textbook listening audio. Based on the "
    "dialogue content, give each raw speaker id a short contextual display name (examples: "
    "Narrator, Man, Woman 1, Interviewer, Student; use names if the dialogue states them, e.g. "
    "Maria). The voice that reads instructions like 'Unit ten quiz, part A' is the Narrator. "
    "Also write ONE plain sentence describing what the recording is (no hype). Return ONLY "
    'JSON: {"description": "...", "speakers": {"speaker_0": "Narrator", ...}}.'
)


def _book_and_section(rel: Path) -> tuple[str, str]:
    """Derive (book, section) from the archive-relative path's folder names."""
    parts = [p for p in rel.parts[:-1] if p.upper() not in _SKIP_SEGMENTS]
    book = parts[0] if parts else "(unfiled)"
    section = " / ".join(parts[1:]) if len(parts) > 1 else ""
    return book.strip(), section.strip()


def _units(rel: Path) -> str:
    """Pull a 'units 7-11' style range out of any path segment, if present."""
    for segment in rel.parts:
        match = _UNITS_RE.search(segment)
        if match:
            return match.group(1).replace(" ", "")
    return ""


def _page(turns: list[Turn]) -> str:
    """Return the first page number a narrator announces in the audio, or ''."""
    for turn in turns:
        match = _PAGE_RE.search(turn.text)
        if match:
            return match.group(1)
    return ""


def _frontmatter(fields: dict[str, object]) -> str:
    """Render YAML frontmatter; values go through json.dumps (valid YAML, fully escaped)."""
    lines = ["---"]
    for key, value in fields.items():
        if value in ("", None):
            continue
        lines.append(f"{key}: {json.dumps(str(value), ensure_ascii=False)}")
    lines.append("---")
    return "\n".join(lines)


def _label_speakers(
    client: SuperwhisperClient, turns: list[Turn], context: str
) -> tuple[str, dict[str, str]]:
    """Ask Sonnet for a recording description + speaker display names; safe fallbacks.

    NOTE: the preview sent here is from the owner's OWN copyrighted textbook audio, transcribed
    for his personal lesson prep. This is a deliberate personal-use exception — it is NOT part of
    the course-generation pipeline (which never feeds copyrighted text to the model), and nothing
    produced here is published in the course.
    """
    preview = "\n".join(f"{t.speaker}: {t.text}" for t in turns)[:6000]
    try:
        parsed = client.generate_json(
            [{"role": "user", "content": f"{_LABEL_BRIEF}\n\nFile: {context}\n\n{preview}"}],
            max_tokens=500,
            model=MODEL,
        )
    except Exception as exc:  # noqa: BLE001 - labelling is best-effort decoration.
        print(f"  labelling failed ({exc}); using raw ids", file=sys.stderr)  # noqa: T201
        return "", {}
    if not isinstance(parsed, dict):
        return "", {}
    data = cast("dict[str, Any]", parsed)
    speakers = data.get("speakers")
    names = {str(k): str(v) for k, v in speakers.items()} if isinstance(speakers, dict) else {}
    return str(data.get("description", "")).strip(), names


def _render_record(client: SuperwhisperClient, record: dict[str, Any]) -> Path | None:
    """Render one JSONL record to its markdown file; returns the path or None if skipped."""
    audio_path = Path(str(record.get("audio_path", ""))).resolve()
    try:
        rel = audio_path.relative_to(ARCHIVE.resolve())
    except ValueError:
        return None
    if ".." in rel.parts:
        return None
    out = audio_path.with_suffix(".md")
    if out.exists():
        return None

    words = cast("list[dict[str, Any]]", (record.get("raw_response") or {}).get("words") or [])
    turns = words_to_turns(words)
    if not turns:
        return None
    book, section = _book_and_section(rel)
    description, names = _label_speakers(client, turns, str(rel))
    duration = max((t.end for t in turns), default=0.0)

    front = _frontmatter(
        {
            "book": book,
            "section": section,
            "audio": audio_path.stem,
            "units": _units(rel),
            "page": _page(turns),
            "duration": f"{int(duration // 60)}:{int(duration % 60):02d}",
            "speakers": len({t.speaker for t in turns}),
            "description": description,
            "source": str(rel),
            "model": str(record.get("model_id", "")),
            "transcribed": str(record.get("datetime", ""))[:10],
        }
    )
    body = to_markdown(turns, speaker_names=names)
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_suffix(".md.tmp")
    tmp.write_text(f"{front}\n\n# {audio_path.stem}\n\n{body}", encoding="utf-8")
    tmp.replace(out)  # atomic: resume never mistakes a partial write for a finished file
    return out


_WORKERS = 32  # Sonnet labelling calls are short; the proxy handles parallel text traffic fine.


def main() -> None:
    """Render every transcribed record that does not yet have a markdown file (in parallel)."""
    if not JSONL.exists():
        sys.exit(f"no JSONL at {JSONL} — run Pass A first")
    records: list[dict[str, Any]] = []
    with JSONL.open(encoding="utf-8") as handle:
        for line in handle:
            try:
                record = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(record, dict) and record.get("transcript") is not None:
                records.append(cast("dict[str, Any]", record))

    client = SuperwhisperClient()
    rendered = 0
    skipped = 0
    with ThreadPoolExecutor(max_workers=_WORKERS) as pool:
        futures = [pool.submit(_render_record, client, record) for record in records]
        failures = 0
        for future in as_completed(futures):
            try:
                path = future.result()
            except Exception as exc:  # noqa: BLE001 - one bad record must not kill the pass.
                failures += 1
                print(f"record failed: {exc}", file=sys.stderr)  # noqa: T201
                continue
            if path is None:
                skipped += 1
                continue
            rendered += 1
            if rendered % 25 == 0:
                print(f"rendered {rendered}...", file=sys.stderr)  # noqa: T201
    print(  # noqa: T201
        f"done: {rendered} rendered, {skipped} skipped, {failures} failed", file=sys.stderr
    )


if __name__ == "__main__":
    main()
