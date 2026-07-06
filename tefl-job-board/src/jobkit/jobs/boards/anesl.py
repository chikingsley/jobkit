"""ANESL (cafe.anesl.com) adapter — static ASP.NET pages, parsed with BeautifulSoup.

`joblist.aspx` lists the newest postings as `jobdetail.aspx?id=<id>`; each detail page is a
clean label/value table (Position ID, Employer's Type, Location, Salary/M, Degree, ...).
"""

from __future__ import annotations

import re
import sys
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

from bs4 import BeautifulSoup

from jobkit.jobs.http import USER_AGENT, fetch
from jobkit.jobs.models import JobPosting

BASE = "https://cafe.anesl.com"
LIST_URL = f"{BASE}/joblist.aspx"

EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
ID_RE = re.compile(r"jobdetail\.aspx\?id=(\d+)", re.IGNORECASE)
CODE_RE = re.compile(r"[A-Z]{1,3}\d{3,}")
TOTAL_RE = re.compile(
    r"Total Records:<b>(\d+)</b>.*?Pages:<b>(\d+)</b>.*?Current Page:<b>(\d+)</b>",
    re.DOTALL,
)

# A label/value table row has two cells; the label cell is short and ends with ":".
PAIR_CELLS = 2
LABEL_MAX_LEN = 40

# joblist.aspx is an ASP.NET WebForm paginated by an AspNetPager control (no ?page= param).
# Pages are walked by POSTing the carried-forward hidden fields with a __doPostBack target.
PAGER_TARGET = "ctl00$ContentPlaceHolder1$AspNetPager1"
PAGESIZE_FIELD = "ctl00$ContentPlaceHolder1$dppagesize"
PAGE_SIZE = 100  # largest page size the dppagesize dropdown offers (fewer requests)
CRAWL_SLEEP_SECONDS = 1.0  # be polite between postbacks
POST_TIMEOUT_SECONDS = 60  # postbacks carry a large __VIEWSTATE and can be slow to render
DEFAULT_MAX_PAGES = 50  # safety cap; 4005 records / 100 ≈ 41 pages covers the whole DB
DETAIL_WORKERS = 4
PROGRESS_EVERY = 50


def _parse_detail(job_id: str, html: str) -> JobPosting:
    soup = BeautifulSoup(html, "html.parser")
    fields: dict[str, str] = {}
    title = ""
    for row in soup.select("tr"):
        cells = [c.get_text(" ", strip=True) for c in row.select("td, th")]
        cells = [c for c in cells if c]
        if len(cells) >= PAIR_CELLS and cells[0].endswith(":") and len(cells[0]) < LABEL_MAX_LEN:
            fields.setdefault(cells[0].rstrip(":").strip(), cells[1])
        elif len(cells) == PAIR_CELLS and not title and CODE_RE.fullmatch(cells[0]):
            title = cells[1]
    if not title and soup.title:
        title = soup.title.get_text(" ", strip=True)
    # ANESL detail pages are a label/value table (no free-text body), so the raw dump is the full
    # set of parsed pairs joined back together.
    raw = "\n".join(f"{key}: {value}" for key, value in fields.items())
    if raw:
        fields["raw"] = raw
    emails = EMAIL_RE.findall(html)
    preferred = [e for e in emails if e.lower().endswith("@anesl.com")]
    return JobPosting(
        board="anesl",
        job_id=job_id,
        url=f"{BASE}/jobdetail.aspx?id={job_id}",
        title=title,
        location=fields.get("Location", ""),
        apply_email=(preferred or emails or [""])[0],
        fields=fields,
    )


def fetch_listings(limit: int = 15) -> list[JobPosting]:
    """Fetch up to `limit` newest ANESL postings (page 1 of joblist.aspx)."""
    ids = list(dict.fromkeys(ID_RE.findall(fetch(LIST_URL))))
    return [_parse_detail(jid, fetch(f"{BASE}/jobdetail.aspx?id={jid}")) for jid in ids[:limit]]


def _hidden_fields(html: str) -> dict[str, str]:
    """Parse the ASP.NET hidden form fields (__VIEWSTATE, etc.) needed for a postback."""
    soup = BeautifulSoup(html, "html.parser")
    fields: dict[str, str] = {}
    for tag in soup.select('input[type="hidden"]'):
        name = tag.get("name")
        if not isinstance(name, str):
            continue
        value = tag.get("value", "")
        fields[name] = value if isinstance(value, str) else ""
    return fields


def _post_list(fields: dict[str, str]) -> str:
    """POST joblist.aspx with the given form fields and return the decoded HTML."""
    body = urllib.parse.urlencode(fields).encode()
    request = urllib.request.Request(  # noqa: S310
        LIST_URL,
        data=body,
        headers={
            "User-Agent": USER_AGENT,
            "Content-Type": "application/x-www-form-urlencoded",
        },
    )
    with urllib.request.urlopen(request, timeout=POST_TIMEOUT_SECONDS) as response:  # noqa: S310
        return response.read().decode("utf-8", "replace")


def list_page_ids(*, max_pages: int = DEFAULT_MAX_PAGES) -> list[str]:
    """Walk the joblist.aspx pager and return every distinct job id (newest set first).

    Emulates the `__doPostBack` pagination: fetch page 1, bump the page size to 100, then
    POST the carried-forward hidden fields for each subsequent page until the pager reports
    the last page or `max_pages` is reached. Stops early if a page yields no ids.
    """
    html = fetch(LIST_URL)
    fields = _hidden_fields(html)
    fields["__EVENTTARGET"] = PAGESIZE_FIELD
    fields["__EVENTARGUMENT"] = ""
    fields[PAGESIZE_FIELD] = str(PAGE_SIZE)
    time.sleep(CRAWL_SLEEP_SECONDS)
    html = _post_list(fields)

    ids: list[str] = []
    seen: set[str] = set()
    for page in range(1, max_pages + 1):
        page_ids = [i for i in dict.fromkeys(ID_RE.findall(html)) if i not in seen]
        if not page_ids:
            break
        ids.extend(page_ids)
        seen.update(page_ids)

        match = TOTAL_RE.search(html)
        total_pages = int(match.group(2)) if match else page
        if page >= total_pages or page >= max_pages:
            break

        fields = _hidden_fields(html)
        fields[PAGESIZE_FIELD] = str(PAGE_SIZE)
        fields["__EVENTTARGET"] = PAGER_TARGET
        fields["__EVENTARGUMENT"] = str(page + 1)
        time.sleep(CRAWL_SLEEP_SECONDS)
        html = _post_list(fields)
    return ids


def fetch_all(*, max_pages: int = DEFAULT_MAX_PAGES, limit: int | None = None) -> list[JobPosting]:
    """Crawl the full joblist.aspx pager and return parsed postings (bounded by `max_pages`).

    Set `limit` to cap how many detail pages are fetched (useful for probing); leave it None
    to fetch every job found across the crawled pages. With the default settings this covers
    the entire ANESL job database (~4000 listings across ~41 pages of 100).
    """
    ids = list_page_ids(max_pages=max_pages)
    if limit is not None:
        ids = ids[:limit]
    return _fetch_details(ids)


def _fetch_detail(job_id: str) -> JobPosting:
    """Fetch and parse one ANESL detail page."""
    return _parse_detail(job_id, fetch(f"{BASE}/jobdetail.aspx?id={job_id}"))


def _fetch_details(ids: list[str]) -> list[JobPosting]:
    """Fetch ANESL detail pages with bounded concurrency, preserving listing order."""
    if not ids:
        return []
    postings: dict[str, JobPosting] = {}
    total = len(ids)
    _warn(f"fetching {total} ANESL detail pages with {DETAIL_WORKERS} workers")
    with ThreadPoolExecutor(max_workers=DETAIL_WORKERS) as executor:
        futures = {executor.submit(_fetch_detail, job_id): job_id for job_id in ids}
        for count, future in enumerate(as_completed(futures), start=1):
            job_id = futures[future]
            postings[job_id] = future.result()
            if count == total or count % PROGRESS_EVERY == 0:
                _warn(f"fetched {count}/{total} ANESL detail pages")
    return [postings[job_id] for job_id in ids]


def _warn(message: str) -> None:
    """Write adapter progress to stderr without polluting stdout result streams."""
    sys.stderr.write(f"anesl: {message}\n")
    sys.stderr.flush()
