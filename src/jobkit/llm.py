"""Minimal client for Superwhisper's signed model API proxy (Claude Sonnet 4.6 only).

This is a trimmed copy of the text-generation slice of the `superwhisper-api` package
(`~/github/peacock-asr/packages/superwhisper-api`). We copy rather than depend on it because
that package is an ASR monolith pulling in fastapi / sounddevice / huggingface — far too heavy
for this scraper. All we need here is: read Superwhisper's cached signed credentials and POST a
chat request to the Anthropic route, then concatenate the streamed text back.

Auth: Superwhisper caches a signed request (`X-ID` / `X-License` / `X-Signature` headers + the
`api.superwhisper.com` base URL) in a CFURL cache DB. On macOS that DB is read live; off-Mac
(this Linux box) the Mac's `Cache.db` is rsynced once over ssh from `$SUPERWHISPER_MAC_HOST`
(default `home-mac`) into `~/.cache/superwhisper-api/`. The existing mirror is reused if present;
set `refresh=True` (or delete it) to re-pull when the signature expires.
"""

from __future__ import annotations

import json
import os
import platform
import plistlib
import shutil
import sqlite3
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any, cast
from urllib.parse import urlsplit

import httpx

# Sonnet 4.6 routes through the proxy's Anthropic-compatible endpoint (see superwhisper-api).
MODEL_ID = "claude-sonnet-4-6"
ANTHROPIC_PATH = "/anthropic/v1/messages"

_MAC_CACHE_DB = Path.home() / "Library/Caches/com.superduper.superwhisper/Cache.db"
_MIRROR_DIR = Path.home() / ".cache" / "superwhisper-api"
_MIRRORED_CACHE_DB = _MIRROR_DIR / "Cache.db"
_CHAT_COMPLETIONS_PATH = "/v1/chat/completions"  # most-recently-signed route; preferred row.

_SIGNED_HEADER_NAMES = ("X-ID", "X-License", "X-Signature")
_NON_FORWARDABLE_HEADERS = {
    "__hhaa__",
    "accept-encoding",
    "connection",
    "content-length",
    "host",
}


@dataclass(frozen=True)
class CachedAuth:
    """Signed base URL and headers extracted from the Superwhisper cache."""

    base_url: str
    headers: dict[str, str]


def _mirror_cache_db() -> None:
    """Rsync the Mac's Superwhisper Cache.db (+ WAL sidecars) into the local mirror."""
    if shutil.which("rsync") is None or shutil.which("ssh") is None:
        msg = "rsync + ssh are required to mirror the Superwhisper cache from the Mac"
        raise RuntimeError(msg)
    host = os.environ.get("SUPERWHISPER_MAC_HOST", "home-mac")
    remote_db = os.environ.get(
        "SUPERWHISPER_MAC_CACHE",
        "~/Library/Caches/com.superduper.superwhisper/Cache.db",
    )
    # The mirror holds signed credentials, so keep it private to the user.
    _MIRROR_DIR.mkdir(parents=True, exist_ok=True)
    _MIRROR_DIR.chmod(0o700)
    rsync_argv = [
        "rsync",
        "-az",
        "-e",
        "ssh -o BatchMode=yes -o ConnectTimeout=10",
        f"{host}:{remote_db}*",  # Cache.db plus its -wal / -shm sidecars
        f"{_MIRROR_DIR}/",
    ]
    subprocess.run(rsync_argv, check=False, capture_output=True, text=True)  # noqa: S603
    if not _MIRRORED_CACHE_DB.exists():
        msg = f"failed to mirror Superwhisper Cache.db from {host}"
        raise RuntimeError(msg)
    for path in _MIRROR_DIR.glob("Cache.db*"):
        path.chmod(0o600)
    # Fold the WAL into the copy so plain read-only queries see the latest writes.
    with sqlite3.connect(_MIRRORED_CACHE_DB) as conn:
        conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")


def _cache_db(*, refresh: bool = False) -> Path:
    """Path to the Superwhisper cache DB — live on macOS, a Mac-mirrored copy elsewhere."""
    if platform.system() == "Darwin":
        return _MAC_CACHE_DB
    if refresh or not _MIRRORED_CACHE_DB.exists():
        _mirror_cache_db()
    return _MIRRORED_CACHE_DB


def _find_signed_headers(payload: object) -> dict[str, object] | None:
    """Recursively search a cached plist payload for the dict holding the signed headers."""
    if isinstance(payload, dict):
        if all(name in payload for name in _SIGNED_HEADER_NAMES):
            return cast("dict[str, object]", payload)
        for value in payload.values():
            found = _find_signed_headers(value)
            if found is not None:
                return found
    elif isinstance(payload, list):
        for value in payload:
            found = _find_signed_headers(value)
            if found is not None:
                return found
    return None


def _headers_from_plist(payload: object) -> dict[str, str]:
    """Build forwardable request headers from the signed request in a cached plist."""
    cached = _find_signed_headers(payload)
    if cached is None:
        msg = "Cached Superwhisper request is missing signed headers."
        raise RuntimeError(msg)
    for name in _SIGNED_HEADER_NAMES:
        if not isinstance(cached.get(name), str) or not cached[name]:
            msg = f"Cached Superwhisper request is missing {name}."
            raise RuntimeError(msg)
    headers: dict[str, str] = {}
    for name, raw in cached.items():
        if not isinstance(name, str) or name.lower() in _NON_FORWARDABLE_HEADERS:
            continue
        value = raw.decode() if isinstance(raw, bytes) else raw
        if isinstance(value, str) and value:
            headers[name] = value
    return headers


def cached_auth(*, refresh: bool = False) -> CachedAuth:
    """Return the signed base URL + headers from the Superwhisper URL cache."""
    cache_db = _cache_db(refresh=refresh)
    if not cache_db.exists():
        msg = f"Superwhisper cache does not exist: {cache_db}"
        raise RuntimeError(msg)
    with sqlite3.connect(f"file:{cache_db}?mode=ro", uri=True) as conn:
        rows = conn.execute(
            """
            select r.request_key, b.request_object
            from cfurl_cache_response r
            join cfurl_cache_blob_data b on b.entry_id = r.entry_id
            where r.request_key like 'https://api.superwhisper.com/%'
            order by
                case when r.request_key like ? then 0 else 1 end,
                r.time_stamp desc
            limit 25
            """,
            (f"%{_CHAT_COMPLETIONS_PATH}",),
        ).fetchall()
    for request_url, request_object in rows:
        payload = request_object.encode() if isinstance(request_object, str) else request_object
        try:
            headers = _headers_from_plist(plistlib.loads(payload))
        except (RuntimeError, ValueError, TypeError):
            # Skip a malformed/non-signed cache row (bad plist, missing headers) and try the next.
            continue
        parsed = urlsplit(request_url)
        return CachedAuth(base_url=f"{parsed.scheme}://{parsed.netloc}", headers=headers)
    msg = "No cached Superwhisper signed request found."
    raise RuntimeError(msg)


def _anthropic_text(events: list[dict[str, Any]], raw_text: str) -> str:
    """Concatenate Anthropic text deltas from the SSE stream (or a single JSON body)."""
    chunks = [
        event["delta"]["text"]
        for event in events
        if isinstance(event.get("delta"), dict) and isinstance(event["delta"].get("text"), str)
    ]
    if chunks:
        return "".join(chunks)
    # The proxy intermittently returns one non-streamed JSON object instead of SSE.
    try:
        payload = json.loads(raw_text)
    except json.JSONDecodeError:
        return raw_text
    blocks = payload.get("content") if isinstance(payload, dict) else None
    if isinstance(blocks, list):
        return "".join(
            b["text"] for b in blocks if isinstance(b, dict) and isinstance(b.get("text"), str)
        )
    return raw_text


def _sse_events(text: str) -> list[dict[str, Any]]:
    """Parse `data: {...}` SSE lines into a list of JSON event dicts."""
    events: list[dict[str, Any]] = []
    for line in text.splitlines():
        if not line.startswith("data: ") or line == "data: [DONE]":
            continue
        try:
            event = json.loads(line.removeprefix("data: "))
        except json.JSONDecodeError:
            continue
        if isinstance(event, dict):
            events.append(event)
    return events


def parse_json_text(text: str) -> object:
    """Parse a string as JSON, stripping ```json markdown fences if present."""
    stripped = text.strip()
    if stripped.startswith("```"):
        lines = stripped.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        stripped = "\n".join(lines).strip()
    return json.loads(stripped)


class SuperwhisperClient:
    """Generates text from Claude Sonnet 4.6 via Superwhisper's signed proxy."""

    def __init__(self, *, timeout: float = 120.0) -> None:
        """Resolve signed auth from the Superwhisper cache and open an HTTP client."""
        auth = cached_auth()
        self._url = auth.base_url.rstrip("/") + ANTHROPIC_PATH
        self._headers = auth.headers
        self._http = httpx.Client(timeout=timeout)

    def generate(self, messages: list[dict[str, str]], *, max_tokens: int = 1024) -> str:
        """Return the model's text for a chat `messages` list."""
        response = self._http.post(
            self._url,
            headers=self._headers,
            json={"model": MODEL_ID, "max_tokens": max_tokens, "messages": messages},
        )
        response.raise_for_status()
        return _anthropic_text(_sse_events(response.text), response.text)

    def generate_json(self, messages: list[dict[str, str]], *, max_tokens: int = 1024) -> object:
        """Return the model's response parsed as JSON (Superwhisper does not enforce schemas)."""
        return parse_json_text(self.generate(messages, max_tokens=max_tokens))

    def close(self) -> None:
        """Close the underlying HTTP client."""
        self._http.close()
