#!/usr/bin/env python3
"""Import the live Serious Teachers private board into the local review queue."""

from __future__ import annotations

import argparse
import html as html_lib
import json
import os
import re
import sqlite3
import urllib.parse
import urllib.request
import urllib.error
from pathlib import Path

BASE = "https://www.seriousteachers.com"
ROOT = Path(__file__).resolve().parents[2]
DB = ROOT / "job-search" / "job-data" / "jobs.sqlite"
USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 JobKit/0.1"
COUNTRIES = (
    "Hungary", "Poland", "Tajikistan", "Oman", "China", "Japan", "Albania",
    "Azerbaijan", "Romania", "Kazakhstan", "Georgia", "Bulgaria",
)


def env() -> dict[str, str]:
    values = dict(os.environ)
    for line in (ROOT / ".env").read_text(encoding="utf-8").splitlines():
        key, sep, value = line.partition("=")
        if sep:
            values.setdefault(key.strip(), value.strip())
    return values


def login() -> urllib.request.OpenerDirector:
    values = env()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor())
    opener.addheaders = [("User-Agent", USER_AGENT)]
    page = opener.open(f"{BASE}/te2/login").read().decode()
    token = re.search(r'name="__RequestVerificationToken"[^>]*value="([^"]+)"', page)
    if not token:
        raise RuntimeError("Serious Teachers login token not found")
    data = urllib.parse.urlencode({"email": values["SERIOUSTEACHERS_EMAIL"], "password": values["SERIOUSTEACHERS_PASSWORD"], "idjob": "0", "idemployer": "0", "__RequestVerificationToken": token.group(1)}).encode()
    opener.open(f"{BASE}/te2/login", data=data)
    return opener


def posting_description(page: str) -> str:
    """Extract the posting's Details block while excluding site chrome and advertisements."""
    text = html_lib.unescape(re.sub(r"\s+", " ", re.sub("<[^>]+>", " ", page)))
    match = re.search(r"\bDetails:\s*(.+?)(?:\s+APPLY\s+|\s+Existing Employers\b)", text, re.I)
    return match.group(1).strip()[:5000] if match else ""


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--api", default="http://localhost:5173")
    parser.add_argument("--token", default=os.environ.get("JOBKIT_ADMIN_TOKEN", ""))
    args = parser.parse_args()
    opener = login()
    pairs: list[tuple[str, str]] = []
    for page in (0, 1):
        panel_html = opener.open(f"{BASE}/te2/seriousteachers_panel/{page}/0/0").read().decode()
        pairs.extend(re.findall(r"/te2/(?:login|respond)/(\d+)/(\d+)", panel_html))
    pairs = list(dict.fromkeys(pairs))
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    jobs = []
    priorities = {"Hungary": 100, "Poland": 95, "Tajikistan": 90, "Oman": 80, "China": 70, "Japan": 40}
    for job_id, employer_id in pairs:
        row = conn.execute("SELECT * FROM jobs WHERE board='seriousteachers' AND job_id=?", (job_id,)).fetchone()
        if row is None:
            detail = opener.open(f"{BASE}/job_details/{job_id}/0/").read().decode(errors="replace")
            response_page = opener.open(f"{BASE}/te2/respond/{job_id}/{employer_id}").read().decode(errors="replace")
            title_match = re.search(r"<h1[^>]*>(.*?)</h1>", detail, re.S | re.I)
            title = html_lib.unescape(re.sub("<[^>]+>", " ", title_match.group(1)).strip()) if title_match else f"Serious Teachers job {job_id}"
            response_text = re.sub(r"\s+", " ", re.sub("<[^>]+>", " ", response_page))
            headings = [html_lib.unescape(re.sub(r"\s+", " ", re.sub("<[^>]+>", " ", item)).strip()) for item in re.findall(r"<h[1-5][^>]*>(.*?)</h[1-5]>", response_page, re.S | re.I)]
            application_heading = headings[1] if len(headings) > 1 else ""
            country = next((name for name in COUNTRIES if name in application_heading), "")
            employer_match = re.search(r"applying to\s+(.+)", headings[0] if headings else "", re.I)
            record = {"title": title, "company": employer_match.group(1).strip() if employer_match else "", "country": country, "location": country, "salary": "", "description": posting_description(detail), "url": f"{BASE}/job_details/{job_id}/0/"}
        else:
            record = dict(row)
        country = record.get("country", "")
        jobs.append({"id": job_id, "board": "seriousteachers", "title": record.get("title", ""), "company": record.get("company", ""), "country": country, "location": record.get("location", ""), "salary": record.get("salary", ""), "description": record.get("description", ""), "sourceUrl": record.get("url", ""), "applyUrl": f"{BASE}/te2/respond/{job_id}/{employer_id}", "employerId": employer_id, "priority": priorities.get(country, 10)})
    conn.close()
    imported = 0
    for job in jobs:
        request = urllib.request.Request(
            f"{args.api.rstrip('/')}/api/import",
            data=json.dumps({"jobs": [job]}).encode(),
            headers={
                "content-type": "application/json",
                "x-jobkit-admin": args.token,
                "user-agent": USER_AGENT,
            },
            method="POST",
        )
        try:
            urllib.request.urlopen(request).read()
            imported += 1
        except urllib.error.HTTPError as error:
            detail = error.read().decode(errors="replace")
            raise RuntimeError(f"Import failed for job {job['id']}: HTTP {error.code}: {detail}") from error
    print(json.dumps({"imported": imported, "ok": True}))


if __name__ == "__main__":
    main()
