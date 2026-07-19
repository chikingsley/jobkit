# Campaign-first product prototype

This is a deliberately isolated, fake-data click-through for agreeing on the
JobKit campaign experience before production implementation.

It assumes onboarding and application-kit setup are complete. No action sends
email, changes D1, or calls a model.

The market picker includes five fake markets to exercise the scalable layout.
A campaign can include up to three countries; additional market sets become
separate campaigns so their calibration, pacing, and replies remain coherent.
Selecting the third country collapses the inventory picker into a compact source
summary and brings the campaign plan into view. The inventory counts describe
everything JobKit knows about those markets; the campaign pool describes the
currently eligible opportunities and contacts admitted under the campaign's
rules.

The current campaign model uses the full eligible pool rather than a fixed send
batch. A campaign starts at a configurable daily pace and pauses after three
human replies by default. Bounces, delivery failures, vacation responders, and
automated acknowledgements do not count. Overlapping campaigns may share
countries, but an authoritative execution claim prevents duplicate outreach to
the same opportunity or contact.

ANESL is represented as an execution route: the campaign chooses the strongest
one to five eligible references and sends one instruction-compliant bundle. It
is not a separate top-level candidate workspace in the intended product model.

Run it from `outreach-product`:

```sh
bunx vite prototypes/campaign-flow --host 0.0.0.0 --port 4175
```

The prototype persists its current screen and simulated campaign state in
browser local storage, and each primary screen has a durable hash URL. Use
**Reset prototype** in the account menu to return to the beginning.
