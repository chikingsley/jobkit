"""Minimal text-generation client for the deployed superwhisper-api HTTP service.

This talks to the deployed service over HTTP with a bearer key. It no longer reads
Superwhisper's cached signed credentials or rsyncs a Mac ``Cache.db`` — all of that now
lives behind the service. The public API is unchanged so call sites need no edits:

    client = SuperwhisperClient()
    text = client.generate([{"role": "user", "content": "hi"}])      # -> str
    data = client.generate_json([{"role": "user", "content": "..."}]) # -> parsed JSON
    client.close()

Config comes from the environment (or the nearest ``.env``):
``SUPERWHISPER_API_BASE`` (e.g. https://superwhisper.peacockery.studio) and
``SUPERWHISPER_API_KEY`` (a ``sw_live_…`` bearer key).
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Self

import httpx

# Default model; the deployed service exposes the same model registry as before.
MODEL_ID = "claude-sonnet-4-6"
_GENERATE_PATH = "/v1/text/generate"
_TIMEOUT = 120.0


def parse_json_text(text: str) -> object:
    """Parse the first JSON value in a model response.

    Tolerates ```json fences, prose before the value ("Here is the JSON: {..."), and
    trailing text after it (the "Extra data" failure mode) — models add all three in
    practice.
    """
    stripped = text.strip()
    if stripped.startswith("```"):
        lines = stripped.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        stripped = "\n".join(lines).strip()
    starts = [i for i in (stripped.find("{"), stripped.find("[")) if i != -1]
    value, _end = json.JSONDecoder().raw_decode(stripped, min(starts) if starts else 0)
    return value


def _load_env_file(start: Path) -> dict[str, str]:
    """Best-effort parse of the nearest ``.env`` (``KEY=VALUE``) walking up from ``start``."""
    for directory in (start, *start.parents):
        env_path = directory / ".env"
        if not env_path.is_file():
            continue
        values: dict[str, str] = {}
        for raw_line in env_path.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            values[key.strip()] = value.strip().strip('"').strip("'")
        return values
    return {}


def _resolve_target() -> tuple[str, str]:
    """Return ``(base_url, api_key)`` from the environment, falling back to a ``.env``."""
    base = os.environ.get("SUPERWHISPER_API_BASE")
    key = os.environ.get("SUPERWHISPER_API_KEY")
    if not base or not key:
        fallback = _load_env_file(Path(__file__).resolve().parent)
        base = base or fallback.get("SUPERWHISPER_API_BASE")
        key = key or fallback.get("SUPERWHISPER_API_KEY")
    if not base or not key:
        msg = (
            "SUPERWHISPER_API_BASE and SUPERWHISPER_API_KEY must be set "
            "(in the environment or a .env file)."
        )
        raise RuntimeError(msg)
    return base.rstrip("/"), key


class SuperwhisperClient:
    """Text generation via the deployed superwhisper-api HTTP service."""

    def __init__(self, *, model: str = MODEL_ID) -> None:
        """Build the client, resolving the service base URL + bearer key."""
        base, key = _resolve_target()
        self._model = model
        self._client = httpx.Client(
            base_url=base,
            headers={"Authorization": f"Bearer {key}"},
            timeout=_TIMEOUT,
        )

    def generate(
        self,
        messages: list[dict[str, str]],
        *,
        max_tokens: int = 1024,
        model: str | None = None,
    ) -> str:
        """Return the model's text for a chat ``messages`` list."""
        response = self._client.post(
            _GENERATE_PATH,
            json={
                "model": model or self._model,
                "max_tokens": max_tokens,
                "messages": messages,
            },
        )
        response.raise_for_status()
        return str(response.json()["text"])

    def generate_json(
        self,
        messages: list[dict[str, str]],
        *,
        max_tokens: int = 1024,
        model: str | None = None,
    ) -> object:
        """Return the model's response parsed as JSON (the service does not enforce schemas)."""
        return parse_json_text(self.generate(messages, max_tokens=max_tokens, model=model))

    def close(self) -> None:
        """Close the underlying HTTP client."""
        self._client.close()

    def __enter__(self) -> Self:
        """Enter a context manager, returning ``self``."""
        return self

    def __exit__(self, *_exc: object) -> None:
        """Exit the context manager, closing the HTTP client."""
        self.close()
