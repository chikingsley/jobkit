# Dogfood Report: JobKit campaign prototype

| Field | Value |
| --- | --- |
| **Date** | 2026-07-18 |
| **App URL** | http://100.121.185.11:4175/ |
| **Session** | jobkit-campaign-prototype |
| **Scope** | Campaign setup, target preview, first-five calibration, running dashboard, reply pause, desktop and iPad landscape |

## Summary

| Severity | Count |
| --- | --- |
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 0 |
| **Total** | **0** |

## Issues

No open issues remained after the pass.

## Verified flows

- Created the default Poland and Georgia campaign with all 167 currently
  eligible targets: 26 advertised opportunities and 141 direct school contacts.
  The prototype uses a starting pace of 10 per day and a three-human-reply stop
  rule.
- Opened a target and verified that source context, qualifications, recipient,
  message, and packet remain inspectable.
- Reviewed the first five messages, interpreted sample feedback, scoped the
  reusable rule to the remaining campaign, and verified the changed text and
  rule count in place.
- Started the campaign after five-message calibration, simulated another daily
  batch, received three human replies, and verified the automatic pause and
  Messages handoff.
- Reloaded the Messages route and verified that both the route and simulated
  state persisted.
- Repeated setup, calibration, and dashboard checks at 1024 x 768. The page had
  no horizontal overflow.
- Verified the five-market picker, country and city search, three-country cap,
  three-country calibration sample, and dynamic per-country dashboard totals.
- Verified that the third selection collapses the market inventory into a
  compact summary and scrolls the campaign plan into view. Removing a market
  reopens the picker; `Change markets` reopens it without clearing selections.
- Verified that the campaign pool exposes all eligible advertised opportunities
  and verified direct-school contacts rather than presenting an arbitrary send
  batch.
- Verified that launch requirements distinguish genuine blockers from writing
  calibration and route-specific documents.
- Verified that coverage expansion requires an explicit research-cost and
  provider confirmation before changing inventory counts.
- Browser errors were empty. The console contained only Vite connection and hot
  update debug messages.

## Resolved during the pass

- Split country selection and `Find more` into separate controls so interactive
  elements are no longer nested.
- Corrected the first-five switch label spacing for screen readers.
- Made campaign names derive from the selected countries instead of remaining
  hard-coded.
- Removed the misleading pointer cursor from the non-interactive country card
  container.
- Replaced the large two-column market cards with a denser searchable grid that
  becomes two columns at iPad landscape width.
- Removed unexplained calibration stars from target and application rows.
- Replaced hard-coded Poland and Georgia dashboard ratios, feedback scope text,
  and simulated reply senders with the active campaign countries and targets.
- Replaced the fixed send queue with a live campaign pool that names current
  eligible inventory, daily pace, human-reply pause rule, and launch gates.
- Added a compact selected-market state so the campaign plan remains visible
  after the maximum three countries are chosen.
- Corrected route navigation so a long target preview cannot carry its scroll
  position into the running dashboard and hide controls under the sticky header.
- Removed the unsupported campaign-size cap and hidden maximum clamps on daily
  pace and human-reply threshold. Both controls now accept the candidate's
  configured positive integer, and the target pool contains every eligible
  record.
