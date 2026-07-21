# Countries and campaigns

## Product model

The Markets index and country workspace are nested views of the same catalog. The index answers “which markets have inventory?” A country workspace answers “what do we currently know about this market, and what should I do next?”

Discovery, campaign calibration, and execution are separate stages:

1. A country refresh discovers and verifies reusable global inventory.
1. A campaign defines selected markets, source mix, daily pace, and reply stop rule.
1. The campaign maintains a user-owned pool of current advertised opportunities and verified school contacts from that inventory.
1. The candidate calibrates the first five messages.
1. The shared execution gate claims and sends eligible targets at the configured daily pace until the campaign pauses, exhausts its pool, or is stopped.

The Campaigns workspace uses a master-detail layout. The list shows campaign status and recent progress; the selected detail shows pool composition, execution, replies, failures, and controls. New-campaign setup is a separate, resumable route. Campaigns, Jobs, and Messages remain in global navigation. Markets is nested under Campaigns; the campaign list is a local work pane rather than a second global sidebar. On a phone, list and detail become sequential routes with a Back action.

## FLOW-020: Browse and refresh one country market

**Actor:** Candidate or operator

**Entry:** Campaigns > Markets.

### Country market journey

1. Review country summaries: open positions, known organizations, verified contacts, current refresh state, and campaign count.
1. Open a country workspace.
1. Inspect current open positions, schools, contacts, and activity.
1. Request a refresh when the catalog is absent or stale.
1. Track discovery, organization verification, and coverage audit.
1. Inspect the reconciled country inventory.

**Terminal state:** The country catalog records the latest verified schools, contacts, evidence, vacancies, duplicates, freshness, and coverage summary.

The refresh expands knowledge. It does not send outreach and does not create fake jobs from school records.

## FLOW-021: Configure and calibrate a country campaign

**Actor:** Candidate

**Entry:** Campaigns, a country workspace with existing inventory, or a completed refresh.

### Campaign journey

1. Choose up to three countries for one operational campaign.
1. Inspect the current pool: advertised opportunities, verified direct-school contacts, freshness, and coverage.
1. Choose the source strategy, daily pace, and human-reply stop rule.
1. Create the campaign. It records the selection rules, source evidence, and each target admitted to the user-owned pool.
1. Preview the exact first five executions across the selected markets and routes.
1. Approve or revise those messages. Reusable feedback updates the remaining campaign guidance before execution begins.
1. Open the campaign dashboard. The candidate can inspect or hold any future target, adjust countries for future admissions, pause, resume, or stop.
1. Newly verified targets may join the eligible pool while the campaign is active when they satisfy its recorded rules. Every admission keeps explicit provenance.

**Terminal state:** The campaign is calibrated and ready to run. Creating or calibrating a campaign does not itself imply an external send.

### Selection refinement

The eligible pool is inventory, not a promise to send a fixed batch. The campaign keeps sending at its configured pace until it receives the configured number of human replies, exhausts the pool, or the candidate stops it. Useful selectors include city, school type, minimum match, and direct-employer route. Provider quotas or measured delivery backpressure may slow execution, but they do not truncate the eligible pool or create an unsupported target cap.

Countries may appear in more than one campaign. Execution is still exactly once: an authoritative claim prevents two campaigns from sending the same opportunity or cold outreach to the same canonical recipient. A successful send becomes `sent_elsewhere` or equivalent in every overlapping campaign. Direct opportunities deduplicate by user, opportunity, route, and recipient; cold school outreach deduplicates by user and canonical contact channel unless a later follow-up policy explicitly permits another message.

## FLOW-022: Run a paced campaign safely

**Actor:** JobKit acting under the candidate's saved policy

**Entry:** A calibrated campaign, an approved manual application, or a route-specific bundle such as ANESL.

This is a shared execution state machine rather than a separate destination in the navigation.

### Gate

1. Confirm the active route and recipient are valid and fresh.
1. Recompute hard eligibility and the configured match threshold.
1. Confirm required-at-submission documents and exact packet versions.
1. Validate the message and deduplication key.
1. Atomically claim the execution across all of the user's campaigns.
1. Enforce campaign state, channel mode, per-contact limits, and daily pace.
1. For an intermediary route such as ANESL, group the best one to five eligible references into the single email required by that route.
1. Execute through Gmail or a supported board executor.
1. Record authoritative success, hold, skip, or failure.
1. Reconcile replies. Any reply authored by a person counts toward the campaign stop rule regardless of sentiment or length. Bounces, delivery failures, vacation responders, and automated acknowledgements do not count.
1. Pause automatically after three human replies by default and direct the candidate to Messages and campaign results.

**Terminal state:** The campaign is paused by its human-reply rule or the candidate, exhausted, stopped, or failed with a visible recovery path. Every target remains sent, held with a reason, skipped as a duplicate or policy decision, failed, or still eligible.

### Current implementation boundary

The production Campaigns workspace implements the master-detail and resumable new-campaign routes, full eligible-pool admission, cross-campaign recipient claims, first-five calibration, user-configured pacing, automatic ANESL bundling, human-reply stopping, and campaign activity history. Country and city discovery feed reusable inventory through resumable hosted runs. The scheduler is active, while external campaign delivery remains locked until the operator explicitly authorizes real sending.
