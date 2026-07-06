"""Minimal polite HTTP fetch shared by board adapters."""

from __future__ import annotations

import time
import urllib.error
import urllib.request
from urllib.parse import urlsplit

USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)
ALLOWED_SCHEMES = {"http", "https"}
DEFAULT_RETRIES = 3
RETRY_SLEEP_SECONDS = 5.0


def _validate_fetch_url(url: str) -> None:
    """Reject non-HTTP URLs before handing them to urllib."""
    scheme = urlsplit(url).scheme
    if scheme not in ALLOWED_SCHEMES:
        msg = f"unsupported fetch URL scheme: {scheme or '(missing)'}"
        raise ValueError(msg)


def fetch(url: str, timeout: int = 30, retries: int = DEFAULT_RETRIES) -> str:
    """GET `url` and return decoded text (real User-Agent, lenient decoding)."""
    _validate_fetch_url(url)
    for attempt in range(1, retries + 1):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})  # noqa: S310
            with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310
                return response.read().decode("utf-8", "replace")
        except (TimeoutError, urllib.error.URLError):
            if attempt >= retries:
                raise
            time.sleep(RETRY_SLEEP_SECONDS * attempt)
    raise RuntimeError
