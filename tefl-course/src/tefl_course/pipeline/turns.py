"""Fold diarized word items into speaker turns and render them as markdown.

Vendored (trimmed) from ``superwhisper_api.audio.formats`` so this Pass-B renderer needs no
dependency on the ``superwhisper_api`` package — it consumes an existing word-level JSONL (from
Pass A) and only needs the fold-to-turns + markdown helpers, not transcription.

ElevenLabs Scribe (and Deepgram with diarization) return word-level items carrying ``speaker_id``,
``start``, ``end``, and ``type`` ("word" / "spacing" / "audio_event"). ``words_to_turns`` folds
those words into speaker TURNS; ``to_markdown`` renders the turns as dialogue. Pure functions over
the raw ``words`` list; no network, no provider coupling.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

# Silence-gap turn splitting is the industry-standard "utterance segmentation" mechanism
# (Deepgram's `utt_split` defaults to 0.8s; provider utterances run ~0.5-10s). The default here is
# deliberately higher because these turns render as dialogue PARAGRAPHS, not subtitle utterances:
# a narrator returning after a long pause starts a fresh paragraph instead of one endless block.
DEFAULT_TURN_GAP_SECONDS = 3.0


@dataclass(frozen=True)
class Turn:
    """One continuous stretch of speech by a single speaker."""

    speaker: str
    start: float
    end: float
    text: str


def words_to_turns(
    words: list[dict[str, Any]], *, turn_gap: float = DEFAULT_TURN_GAP_SECONDS
) -> list[Turn]:
    """Fold provider word items into consecutive same-speaker turns.

    A turn breaks on speaker change or a silence longer than ``turn_gap`` seconds (see the module
    note on the default). Items whose ``type`` is not "word" or "spacing" are skipped (audio
    events); spacing items join the surrounding words. Unlabelled words inherit the label
    "speaker_0" so undiarized output still renders.

    Provider shapes differ: Scribe uses ``text`` + ``speaker_id`` and explicit spacing items,
    while Deepgram uses ``word``/``punctuated_word`` + ``speaker``. This function accepts either
    shape and normalizes while folding.
    """
    turns: list[Turn] = []
    current_speaker: str | None = None
    current_start = 0.0
    current_end = 0.0
    parts: list[str] = []

    def flush() -> None:
        text = "".join(parts).strip()
        if current_speaker is not None and text:
            turns.append(Turn(current_speaker, current_start, current_end, text))
        parts.clear()

    for item in words:
        kind = item.get("type", "word")
        if kind == "spacing":
            parts.append(str(item.get("text", " ")))
            continue
        if kind != "word":
            continue
        speaker = _speaker_id(item)
        start = float(item.get("start") or 0.0)
        end = float(item.get("end") or start)
        text = _word_text(item)
        gap = start - current_end
        if speaker != current_speaker or gap > turn_gap:
            flush()
            current_speaker = speaker
            current_start = start
        if parts and not parts[-1].endswith((" ", "\n")) and not _joins_previous(text):
            parts.append(" ")
        parts.append(text)
        current_end = end
    flush()
    return turns


def to_markdown(
    turns: list[Turn],
    *,
    speaker_names: dict[str, str] | None = None,
    include_timestamps: bool = True,
) -> str:
    """Render turns as markdown dialogue, one paragraph per turn.

    ``speaker_names`` maps raw ids (speaker_0) to display names; unmapped ids render as "Speaker 1"
    style labels. Single-speaker transcripts render as paragraphs without speaker labels, but keep
    timestamps by default.
    """
    names = speaker_names or {}
    distinct = sorted({t.speaker for t in turns})
    if len(distinct) <= 1:
        return "\n\n".join(
            _with_optional_clock(t, include_timestamps=include_timestamps) for t in turns
        ) + ("\n" if turns else "")
    fallback = {sid: f"Speaker {i + 1}" for i, sid in enumerate(distinct)}

    def clock(turn: Turn) -> str:
        return f" [{_clock(turn.start)}]" if include_timestamps else ""

    lines = [
        f"**{_md_safe(names.get(t.speaker, fallback[t.speaker]))}**{clock(t)}  {t.text}"
        for t in turns
    ]
    return "\n\n".join(lines) + "\n"


def _speaker_id(item: dict[str, Any]) -> str:
    """Return a normalized speaker id from Scribe or Deepgram word data."""
    value = item.get("speaker_id")
    if value is None:
        value = item.get("speaker")
    if value is None or value == "":
        return "speaker_0"
    if isinstance(value, int):
        return f"speaker_{value}"
    text = str(value)
    return text if text.startswith("speaker_") else f"speaker_{text}"


def _word_text(item: dict[str, Any]) -> str:
    """Return visible word text from Scribe or Deepgram word data."""
    value = item.get("text") or item.get("punctuated_word") or item.get("word") or ""
    return str(value)


def _joins_previous(text: str) -> bool:
    """Return True when a token conventionally joins the previous token."""
    return text.startswith(("'", ".", ",", "?", "!", ":", ";", "%", ")", "]", "}"))


def _with_optional_clock(turn: Turn, *, include_timestamps: bool) -> str:
    """Prefix a turn with an inline timestamp when requested."""
    return f"[{_clock(turn.start)}]  {turn.text}" if include_timestamps else turn.text


def _clock(seconds: float) -> str:
    """Format seconds as m:ss (or h:mm:ss past an hour) for inline markdown timestamps."""
    total = int(seconds)
    if total >= 3600:  # noqa: PLR2004 - seconds in an hour.
        return f"{total // 3600}:{total % 3600 // 60:02d}:{total % 60:02d}"
    return f"{total // 60}:{total % 60:02d}"


def _md_safe(name: str) -> str:
    """Neutralize markdown-significant characters in a speaker display name."""
    cleaned = name
    for ch in "*_#`[]>":
        cleaned = cleaned.replace(ch, "")
    return " ".join(cleaned.split()) or "Speaker"  # collapse newlines/whitespace runs
