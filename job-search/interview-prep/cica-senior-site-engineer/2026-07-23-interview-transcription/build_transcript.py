"""Build readable and machine-auditable transcript artifacts from Voice job JSON."""

# ruff: noqa: INP001

from __future__ import annotations

import hashlib
import json
import re
import subprocess
from collections import Counter
from pathlib import Path
from typing import Any

WORK_DIR = Path(__file__).resolve().parent
FFPROBE_PATH = "/usr/bin/ffprobe"
CHUNKS_DIR = WORK_DIR / "chunks"
JOBS_DIR = WORK_DIR / "jobs"
TRANSCRIPT_PATH = WORK_DIR.parent / "2026-07-23-cica-senior-site-engineer-interview-transcript.md"
PLAIN_TEXT_PATH = WORK_DIR / "scribe-plain-text.txt"
MANIFEST_PATH = WORK_DIR / "manifest.json"
ORIGINAL_PATH = WORK_DIR.parent / "2026-07-23-cica-senior-site-engineer-interview.m4a"
FULL_SOURCE_PATH = WORK_DIR / "full-transcription-source.m4a"

MAX_TURN_SECONDS = 35.0
MAX_SAME_SPEAKER_GAP_SECONDS = 2.0
SOFT_SPLIT_GAP_SECONDS = 0.8
SENTENCE_END = re.compile(r"""[.!?]["']?$""")


def media_duration(path: Path) -> float:
    """Return the media duration reported by the system ffprobe binary."""
    completed = subprocess.run(  # noqa: S603 - fixed executable and task-owned media paths
        [
            FFPROBE_PATH,
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "csv=p=0",
            str(path),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    return float(completed.stdout.strip())


def sha256(path: Path) -> str:
    """Calculate a file's SHA-256 digest without loading it fully into memory."""
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def timestamp(seconds: float) -> str:
    """Format seconds as an hour-minute-second transcript timestamp."""
    total_seconds = max(0, round(seconds))
    hours, remainder = divmod(total_seconds, 3600)
    minutes, secs = divmod(remainder, 60)
    return f"{hours:02d}:{minutes:02d}:{secs:02d}"


def clean_join(tokens: list[str]) -> str:
    """Join provider word tokens while preserving spoken wording."""
    text = " ".join(token.strip() for token in tokens if token.strip())
    replacements = {
        " n't": "n't",
        " 'd": "'d",
        " 'll": "'ll",
        " 'm": "'m",
        " 're": "'re",
        " 's": "'s",
        " 've": "'ve",
        " ,": ",",
        " .": ".",
        " :": ":",
        " ;": ";",
        " !": "!",
        " ?": "?",
    }
    for old, new in replacements.items():
        text = text.replace(old, new)
    return re.sub(r"\s+", " ", text).strip()


def speaker_label(chunk_index: int, speaker: str) -> str:
    """Return proved participant names and a neutral label for other voices."""
    if speaker == "speaker_0":
        return "Chi"
    if speaker == "speaker_1":
        return "Jeff"
    if speaker == "speaker_2":
        return "Watson"
    if chunk_index == 0 and speaker == "speaker_3":
        return "Mando"
    return "Unassigned speaker"


def merge_words(
    words: list[dict[str, Any]], chunk_index: int, offset_seconds: float
) -> list[dict[str, Any]]:
    """Merge adjacent provider words into readable, bounded speaker turns."""
    turns: list[dict[str, Any]] = []
    for word in words:
        start = float(word["start_seconds"])
        end = float(word["end_seconds"])
        speaker = str(word.get("speaker") or "speaker_unknown")
        token = str(word["text"])
        current = turns[-1] if turns else None
        should_split = current is None
        if current is not None:
            gap = start - current["local_end"]
            turn_duration = end - current["local_start"]
            sentence_finished = bool(
                current["tokens"] and SENTENCE_END.search(current["tokens"][-1])
            )
            should_split = (
                speaker != current["speaker"]
                or gap > MAX_SAME_SPEAKER_GAP_SECONDS
                or (
                    turn_duration > MAX_TURN_SECONDS
                    and (sentence_finished or gap > SOFT_SPLIT_GAP_SECONDS)
                )
            )
        if should_split:
            turns.append(
                {
                    "chunk_index": chunk_index,
                    "end": offset_seconds + end,
                    "local_end": end,
                    "local_start": start,
                    "speaker": speaker,
                    "start": offset_seconds + start,
                    "tokens": [token],
                }
            )
            continue
        current["end"] = offset_seconds + end
        current["local_end"] = end
        current["tokens"].append(token)
    for turn in turns:
        turn["text"] = clean_join(turn.pop("tokens"))
    return turns


def main() -> None:
    """Build Markdown, plain-text, and manifest artifacts from completed jobs."""
    job_paths = sorted(JOBS_DIR.glob("chunk-*.json"))
    chunk_paths = sorted(CHUNKS_DIR.glob("chunk-*.m4a"))
    if len(job_paths) != len(chunk_paths) or not job_paths:
        message = "Every chunk requires one completed Voice job JSON"
        raise RuntimeError(message)

    offset_seconds = 0.0
    all_turns: list[list[dict[str, Any]]] = []
    plain_sections: list[str] = []
    manifest_chunks: list[dict[str, Any]] = []

    for chunk_index, (chunk_path, job_path) in enumerate(zip(chunk_paths, job_paths, strict=True)):
        job = json.loads(job_path.read_text(encoding="utf-8"))
        if job["status"] != "succeeded":
            message = f"{job_path.name} has status {job['status']}"
            raise RuntimeError(message)
        words = job["result"]["content"]["words"]["items"]
        duration_seconds = media_duration(chunk_path)
        turns = merge_words(words, chunk_index, offset_seconds)
        all_turns.append(turns)
        plain_sections.append(
            f"===== CHUNK {chunk_index:02d} | "
            f"{timestamp(offset_seconds)}-{timestamp(offset_seconds + duration_seconds)} =====\n"
            f"{job['result']['text'].strip()}"
        )
        speaker_counts = Counter(str(word.get("speaker") or "speaker_unknown") for word in words)
        manifest_chunks.append(
            {
                "chunk": chunk_index,
                "duration_seconds": duration_seconds,
                "job_file": job_path.name,
                "job_id": job["job_id"],
                "offset_seconds": offset_seconds,
                "sha256": sha256(chunk_path),
                "speaker_word_counts": dict(sorted(speaker_counts.items())),
                "status": job["status"],
                "text_characters": len(job["result"]["text"]),
                "word_count": len(words),
            }
        )
        offset_seconds += duration_seconds

    lines = [
        "# Cica Senior Site Engineer Interview Transcript",
        "",
        "- **Interview date:** July 23, 2026",
        "- **Role:** Senior Site Engineer",
        "- **Company:** Cica Huntek",
        "- **Applicant:** Chi",
        "- **Known participants from recollection:** Mando (HR), Jeff, and Watson",
        "- **Transcription:** Peacockery Voice Lab, `elevenlabs-scribe_v2`, batch diarization",
        f"- **Original duration:** {timestamp(media_duration(ORIGINAL_PATH))}",
        "",
        "## Speaker-label status",
        "",
        (
            "Chi is identified as `speaker_0` throughout the five chunks from the "
            "opening self-introduction and the dominant project-answer role. Mando "
            "is identified as `speaker_3` in chunk 00 because he introduces himself "
            "immediately before saying that he is in HR. Scribe heard his name as "
            "“Mondo.” Jeff is identified as `speaker_1`: at 00:57:50 he asks whether "
            "Chi likes working in clean rooms, and at 00:58:29 he explains that the "
            "clean-room clothing is hot. His question-dominant role remains "
            "consistent across the chunks. Watson is identified as `speaker_2` in "
            "chunks 00 through 02 from the second-interviewer pattern and the "
            "participant list. Scribe assigns chunk-local labels, so these names "
            "combine recorded evidence with conversational continuity across the "
            "chunk boundaries."
        ),
        "",
        (
            "This document preserves Scribe's words while grouping adjacent timed "
            "words into readable turns. It applies global timestamps from the "
            "original recording. The canonical job JSON files retain every provider "
            "word, timing, speaker label, and provenance field."
        ),
        "",
        "## Transcript",
        "",
    ]
    for chunk_index, turns in enumerate(all_turns):
        chunk = manifest_chunks[chunk_index]
        chunk_end = chunk["offset_seconds"] + chunk["duration_seconds"]
        lines.extend(
            [
                f"### Chunk {chunk_index:02d}: "
                f"{timestamp(chunk['offset_seconds'])}-{timestamp(chunk_end)}",
                "",
            ]
        )
        for turn in turns:
            lines.extend(
                [
                    f"**[{timestamp(turn['start'])}-{timestamp(turn['end'])}] "
                    f"{speaker_label(chunk_index, turn['speaker'])} "
                    f"({turn['speaker']})**",
                    "",
                    turn["text"],
                    "",
                ]
            )

    TRANSCRIPT_PATH.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")
    PLAIN_TEXT_PATH.write_text("\n\n".join(plain_sections).rstrip() + "\n", encoding="utf-8")
    manifest = {
        "chunks": manifest_chunks,
        "full_transcription_source": {
            "duration_seconds": media_duration(FULL_SOURCE_PATH),
            "path": FULL_SOURCE_PATH.name,
            "sha256": sha256(FULL_SOURCE_PATH),
            "size_bytes": FULL_SOURCE_PATH.stat().st_size,
        },
        "model": "elevenlabs-scribe_v2",
        "original": {
            "duration_seconds": media_duration(ORIGINAL_PATH),
            "path": f"../{ORIGINAL_PATH.name}",
            "sha256": sha256(ORIGINAL_PATH),
            "size_bytes": ORIGINAL_PATH.stat().st_size,
        },
        "transcription_environment": "voice-lab",
    }
    MANIFEST_PATH.write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )


if __name__ == "__main__":
    main()
