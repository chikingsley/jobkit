"""Modern Dave's ESL Cafe job board (www.eslcafe.com/jobs) adapter.

The modern site is an AngularJS single-page app; the visible listings are loaded
from a JSON API rather than server-rendered, so the HTML of ``/jobs/*`` itself is an
empty shell. There are three independent job boards, identified by a ``jobBoardSlug``:
``korea``, ``china`` and ``international``.

API we rely on:
- Listings come from ``GET /api/list/PostAJobList`` as paginated JSON. Query params:
  ``jobBoardSlug`` (one of the three), ``page`` (1-based), ``size`` (page size; the
  site uses 60), ``name`` (search filter, left empty), ``sortColumn=SortOrder``,
  ``sortType=asc`` and ``jobType=1`` (1 = regular listings; 2 = paid/premium ads).
  The response carries ``paging`` (``page``, ``lastPage``, ``size``, ``total``) and a
  ``data`` array of postings (``jobTitle``, ``company``, ``slug``, ``statusStartDate``,
  ``isOpenNewTab``). We paginate by incrementing ``page`` until ``page >= lastPage``.
- Each listing's full free-text description is server-rendered at
  ``GET /postajob-detail/{slug}`` (HTML, not JSON). That URL is also the public link
  shown to users. We parse it with BeautifulSoup.

Detail-page layout:
- The whole posting lives in ``div.job-details``: an ``<h1>`` title, a
  ``div.author-desc`` header (location text, then a "Posted by:" company and an
  optional "Contact:" email), then the free-text description as sibling paragraphs.
- Email addresses are obfuscated by Cloudflare's email-protection (a
  ``span.__cf_email__`` with a hex ``data-cfemail`` attribute, XOR-encoded with its
  own first byte as the key), so cleartext regex scraping mostly fails; we decode the
  ``data-cfemail`` values instead. An external apply link (Google Form / careers site)
  usually appears as an ``http(s)`` anchor inside the description.

Scope of the deliverable:
- ``fetch_listings(limit, board)`` returns the newest postings from one board
  (default international), fetching one detail page each, with polite sleeps.
- ``fetch_all(boards, max_pages, limit)`` crawls all three boards (or a subset) across
  pages, bounded by ``max_pages`` per board and an optional global ``limit``, fetching
  every detail page with a polite sleep between every request.
"""

from __future__ import annotations

import json
import re
import time
from typing import Any
from urllib.parse import quote, urlencode

from bs4 import BeautifulSoup, NavigableString, Tag

from jobkit.jobs.http import fetch
from jobkit.jobs.models import JobPosting

BOARD = "eslcafe-modern"
BASE = "https://www.eslcafe.com"
LIST_API = f"{BASE}/api/list/PostAJobList"
DETAIL_BASE = f"{BASE}/postajob-detail"

# The three job boards exposed by the modern site, by jobBoardSlug.
BOARD_SLUGS: dict[str, str] = {
    "korea": "korea",
    "china": "china",
    "international": "international",
}
DEFAULT_BOARD = "international"

PAGE_SIZE = 60  # what the site itself requests
DEFAULT_MAX_PAGES = 5  # bounded crawl default; raise deliberately for a bigger pull.
JOB_TYPE_REGULAR = 1  # 1 = regular listings; 2 = paid/premium ads.

CRAWL_SLEEP_SECONDS = 1.0  # be polite between every request

EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")

# A clean body excerpt cap (characters) so fields["body"] stays a usable summary.
BODY_EXCERPT_CHARS = 1500


def _decode_cf_email(encoded: str) -> str:
    """Decode a Cloudflare-obfuscated email (hex, XOR'd with its leading byte)."""
    try:
        key = int(encoded[:2], 16)
        return "".join(chr(int(encoded[i : i + 2], 16) ^ key) for i in range(2, len(encoded), 2))
    except ValueError:
        return ""


def _list_page(board_slug: str, page: int, size: int) -> dict[str, Any]:
    """Fetch one page of the listing API and return the decoded JSON object."""
    query = urlencode(
        {
            "jobBoardSlug": board_slug,
            "page": page,
            "size": size,
            "name": "",
            "sortColumn": "SortOrder",
            "sortType": "asc",
            "jobType": JOB_TYPE_REGULAR,
        },
    )
    payload: dict[str, Any] = json.loads(fetch(f"{LIST_API}?{query}"))
    return payload


def _format_posted(raw: str) -> str:
    """Trim an ISO-ish ``statusStartDate`` to ``YYYY-MM-DD HH:MM`` when possible."""
    match = re.match(r"(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})", raw)
    if match:
        return f"{match.group(1)} {match.group(2)}"
    return raw


def _leading_location(block: Tag) -> str:
    """Return the free text before the first ``<br>`` (the location line)."""
    for node in block.children:
        if isinstance(node, NavigableString):
            text = node.strip()
            if text:
                return text
        elif isinstance(node, Tag) and node.name == "br":
            break
    return ""


def _text_after_strong(strong: Tag) -> str:
    """Return the first non-empty text node following a ``<strong>`` label."""
    sibling = strong.next_sibling
    while isinstance(sibling, NavigableString) and not sibling.strip():
        sibling = sibling.next_sibling
    if isinstance(sibling, NavigableString):
        return sibling.strip()
    return ""


def _contact_email(strong: Tag) -> str:
    """Email following a "Contact:" label, decoding Cloudflare obfuscation if present."""
    cf = strong.find_next("span", class_="__cf_email__")
    if isinstance(cf, Tag):
        cfemail = cf.get("data-cfemail")
        if isinstance(cfemail, str):
            decoded = _decode_cf_email(cfemail)
            if decoded:
                return decoded
    match = EMAIL_RE.search(_text_after_strong(strong))
    return match.group(0) if match else ""


def _parse_author_desc(block: Tag) -> tuple[str, str, str]:
    """Pull (location, company, email) from a ``div.author-desc`` header block."""
    location = _leading_location(block)
    company = ""
    email = ""
    for strong in block.find_all("strong"):
        label = strong.get_text(" ", strip=True).rstrip(":").lower()
        if label == "posted by":
            company = _text_after_strong(strong)
        elif label == "contact":
            email = _contact_email(strong)
    return location, company, email


def _body_text(block: Tag) -> str:
    """Full cleaned free-text description from the job-details block (uncapped)."""
    clone = BeautifulSoup(str(block), "html.parser")
    for noise in clone.select("h1, div.author-desc, script, style"):
        noise.decompose()
    text = clone.get_text("\n", strip=True)
    return re.sub(r"\n{2,}", "\n", text).strip()


def _find_apply_url(block: Tag) -> str:
    """First external (non-eslcafe, non-cloudflare) http(s) link in the description."""
    for anchor in block.select("a[href]"):
        href = anchor.get("href")
        if not isinstance(href, str):
            continue
        if not href.startswith(("http://", "https://")):
            continue
        if "eslcafe.com" in href or "/cdn-cgi/" in href:
            continue
        return href
    return ""


def _parse_detail(board_slug: str, item: dict[str, Any], html: str) -> JobPosting:
    """Build a JobPosting from a listing item plus its detail-page HTML."""
    slug = str(item.get("slug", ""))
    title = str(item.get("jobTitle", "")).strip()
    company = str(item.get("company", "")).strip()
    posted = _format_posted(str(item.get("statusStartDate", "")))

    soup = BeautifulSoup(html, "html.parser")
    block = soup.select_one("div.job-details")

    location = ""
    apply_email = ""
    body = ""
    apply_url = ""

    if isinstance(block, Tag):
        if not title:
            heading = block.select_one("h1")
            if heading is not None:
                title = heading.get_text(" ", strip=True)
        author = block.select_one("div.author-desc")
        if isinstance(author, Tag):
            location, detail_company, apply_email = _parse_author_desc(author)
            if detail_company:
                company = detail_company
        body = _body_text(block)
        apply_url = _find_apply_url(block)

    if not apply_email:
        emails = EMAIL_RE.findall(body)
        if emails:
            apply_email = emails[0]

    fields: dict[str, str] = {
        "company": company,
        "posted": posted,
        "board_slug": board_slug,
        "raw": body,
        "body": body[:BODY_EXCERPT_CHARS],
    }
    if apply_url:
        fields["apply_url"] = apply_url

    return JobPosting(
        board=BOARD,
        job_id=slug,
        url=f"{DETAIL_BASE}/{quote(slug)}",
        title=title,
        location=location,
        apply_email=apply_email,
        fields=fields,
    )


def _resolve_board(board: str) -> str:
    """Map a friendly board name to its API slug, raising on unknown values."""
    slug = BOARD_SLUGS.get(board)
    if slug is None:
        known = ", ".join(sorted(BOARD_SLUGS))
        msg = f"unknown board {board!r}; expected one of: {known}"
        raise ValueError(msg)
    return slug


def fetch_listings(limit: int = 15, board: str = DEFAULT_BOARD) -> list[JobPosting]:
    """Newest postings from one board (default international), with detail pages.

    Fetches the first listing page of `board`, then one detail page per posting (newest
    first) up to `limit`, sleeping politely between detail fetches.
    """
    board_slug = _resolve_board(board)
    payload = _list_page(board_slug, page=1, size=PAGE_SIZE)
    items = payload.get("data", [])[:limit]
    postings: list[JobPosting] = []
    for item in items:
        slug = str(item.get("slug", ""))
        if not slug:
            continue
        time.sleep(CRAWL_SLEEP_SECONDS)
        html = fetch(f"{DETAIL_BASE}/{quote(slug)}")
        postings.append(_parse_detail(board_slug, item, html))
    return postings


def fetch_all(
    *,
    boards: list[str] | None = None,
    max_pages: int = DEFAULT_MAX_PAGES,
    limit: int | None = None,
) -> list[JobPosting]:
    """Crawl all three boards (or a subset), bounded, fetching every detail page.

    `boards` defaults to all three (korea, china, international); pass a subset of those
    names for a narrower pull. `max_pages` caps listing pages **per board** and `limit`
    caps the total number of detail pages fetched overall. Sleeps between every request.
    """
    names = boards if boards is not None else list(BOARD_SLUGS)
    postings: list[JobPosting] = []
    for name in names:
        board_slug = _resolve_board(name)
        page = 1
        while page <= max_pages:
            time.sleep(CRAWL_SLEEP_SECONDS)
            payload = _list_page(board_slug, page=page, size=PAGE_SIZE)
            items = payload.get("data", [])
            if not items:
                break
            for item in items:
                if limit is not None and len(postings) >= limit:
                    return postings
                slug = str(item.get("slug", ""))
                if not slug:
                    continue
                time.sleep(CRAWL_SLEEP_SECONDS)
                html = fetch(f"{DETAIL_BASE}/{quote(slug)}")
                postings.append(_parse_detail(board_slug, item, html))
            last_page = int(payload.get("paging", {}).get("lastPage", page))
            if page >= last_page:
                break
            page += 1
    return postings


if __name__ == "__main__":
    for job in fetch_listings(limit=5):
        print(f"\n{job.title}  [{job.job_id}]")  # noqa: T201
        print(f"  url:      {job.url}")  # noqa: T201
        print(f"  company:  {job.fields.get('company')}")  # noqa: T201
        print(f"  location: {job.location}")  # noqa: T201
        print(f"  posted:   {job.fields.get('posted')}")  # noqa: T201
        print(f"  email:    {job.apply_email or '-'}")  # noqa: T201
        print(f"  apply:    {job.fields.get('apply_url', '-')}")  # noqa: T201
        body = job.fields.get("body", "")
        print(f"  body:     {body[:160]!r}")  # noqa: T201
