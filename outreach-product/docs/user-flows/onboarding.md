# Onboarding

## FLOW-001: Account through first ready workspace

**Actor:** Candidate

**Entry:** A public Apply with JobKit action, `/app/*` without an authenticated session, or the Sign in action.

**Preconditions:** None.

### Journey

1. Create an account or sign in. Preserve a selected public job when onboarding began from `FLOW-000`.
1. Choose a resume and upload it, or choose to build the profile manually.
1. Review extracted profile facts before they become application facts.
1. Correct and save the profile.
1. Set job and market preferences.
1. Review the private application documents and upload a resume if the import path did not already store one.
1. Finish onboarding and open the matched-job workspace.
1. Add route-specific documents later from Settings when a job requires them.

### State transitions

- Account creation establishes the user identity and browser session.
- Resume upload creates a private document version and a reviewable import proposal.
- Saving Profile creates a versioned user profile.
- Saving Preferences creates a versioned preference set.
- Completing onboarding records the completion timestamp only after Profile, Preferences, and an owned resume exist.

### Terminal state

The candidate reaches the Jobs workspace with an editable profile, saved preferences, and an owned resume ready for application packets.

### Failure and recovery

- Resume extraction failure returns to resume selection or manual profile entry.
- Closing the browser preserves each durable completed step.
- A missing resume prevents onboarding completion. Other missing documents do not invalidate truthful profile claims; they block only routes that require the file at submission time.

### Current implementation

Account creation, resume/manual choice, Codex extraction, profile review, preferences, durable document ownership, completion gating, and cross-account document isolation are implemented and covered by one fresh-member integration journey.
