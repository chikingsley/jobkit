# ANESL source contract

Live check: 2026-07-20.

- Origin: `https://cafe.anesl.com`.
- Stable identity: numeric `id` in `jobdetail.aspx?id={id}`.
- Discovery: `joblist.aspx` is an ASP.NET WebForm. Full discovery carries forward hidden fields, selects the source's maximum 100-row page size, and posts `ctl00$ContentPlaceHolder1$AspNetPager1` until the source-reported final page.
- Completion proof: every page must retain the original record and page totals, return the requested current page, expose IDs when records exist, and yield exactly the source-reported record count after deduplication.
- Detail: the page is a label/value table. Every parsed pair is retained as source evidence. Canonical salary and degree fields are copied only from the explicit `Salary/M` and `Degree` labels.
- Contact: prefer the board's `@anesl.com` address when a page exposes multiple addresses.
- Scope fact: ANESL is a China-specific board, so collected rows carry `China` when the page omits a country label.
