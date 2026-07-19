# Outreach runtime and state ownership

Status: Current architecture.

JobKit has one outreach runtime: the hosted React, Worker, D1, R2, Gmail, and
paired-Codex application in this repository. The sibling `job-search` package
keeps source inventory, resumes, historical correspondence, and the
evidence-backed playbook. It no longer has a second drafting, Gmail, or
follow-up implementation.

## Ownership

| Fact or action | Authoritative owner |
|---|---|
| Candidate profile, preferences, documents, and explicit claims | D1 and R2 |
| Current jobs, organizations, routes, and canonical contacts | D1 |
| Matching decision shown in Jobs and used by Campaigns | Versioned hosted matching engine |
| Message policy, calibrated examples, drafts, revisions, and follow-ups | D1 plus paired Codex tasks |
| Recipient claims, attempts, campaign runs, and deduplication | D1 transactions |
| Mailbox identity, actual sent state, threads, and replies | Gmail, reconciled into D1 |
| Local discovery and inventory compute | Paired Codex runner, publishing versioned results to D1 |

The Worker owns authentication, scheduling, deterministic validation,
idempotency, and audit state. The paired Codex runner receives a versioned task
and strict output schema over outbound HTTPS. It never receives Gmail tokens or
direct database access.

## Initial delivery

1. A reviewed application message and immutable document packet become an
   approved attempt or campaign dispatch.
2. A recipient claim prevents another route, job, or campaign from contacting
   the same canonical recipient concurrently.
3. Gmail creates the exact MIME draft, sends it only through the explicit
   delivery action or authorized campaign policy, and returns message and
   thread identifiers.
4. JobKit verifies the Gmail message has the `SENT` label before recording a
   successful delivery. An ambiguous send becomes `uncertain`, never silently
   successful.

## Replies and follow-ups

Gmail Pub/Sub identifies mailbox history changes. JobKit retrieves the message,
attributes it to a known attempt, and classifies it as human, automated,
vacation, or bounce. Every person-authored reply counts toward a campaign's
configured pause rule regardless of wording or length.

Follow-up timing is user-configured. An empty sequence means follow-ups are
off. Each configured number is the wait after the previous verified sent
message. When a wait is due and no human reply exists, the Worker queues a
paired Codex task. The reviewed result appears in Messages; creating the Gmail
draft is a separate explicit action, and sending that draft requires another
explicit action. JobKit verifies the resulting message in the original Gmail
thread before the next configured wait begins. The draft includes the original
Gmail thread ID plus `In-Reply-To` and `References` headers. A human reply or
bounce cancels pending follow-ups. There is no product-wide 4/10-day cadence or
hidden maximum.

## Local and hosted boundary

The local machine provides replaceable compute for source discovery,
classification, extraction, and drafting through the paired Codex runner. The
application remains usable across desktop and iPad because all product state
lives in hosted services. Stopping the local runner pauses queued compute; it
does not lose campaigns, messages, documents, or Gmail history.

The canonical operator surface is:

```bash
bun run jobkit -- agent connect
bun run jobkit -- agent start
bun run jobkit -- inventory sync
```

Historical message evidence remains under
`../job-search/job-data/outreach-sent/`, and the current writing rules remain in
`../job-search/docs/job-search-playbook.md` plus the versioned message policy in
the Worker.
