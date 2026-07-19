# Onboarding

## FLOW-001: Account through first ready workspace

**Actor:** Candidate

**Entry:** The public JobKit URL without an authenticated session.

**Preconditions:** None.

### Journey

1. Create an account or sign in.
2. Choose a resume and upload it, or choose to build the profile manually.
3. Review extracted profile facts before they become application facts.
4. Correct and save the profile.
5. Set job and market preferences.
6. Finish onboarding and open the matched-job workspace.
7. Review recommended document readiness from Documents. Documents that are
   required for a future route remain actionable without reopening onboarding.

### State transitions

- Account creation establishes the user identity and browser session.
- Resume upload creates a private document version and a reviewable import
  proposal.
- Saving Profile creates a versioned user profile.
- Saving Preferences creates a versioned preference set.
- Completing onboarding records the completion timestamp only after Profile and
  Preferences exist.

### Terminal state

The candidate reaches the Jobs workspace with an editable profile, saved
preferences, and explicit document-readiness recommendations.

### Failure and recovery

- Resume extraction failure returns to resume selection or manual profile entry.
- Closing the browser preserves each durable completed step.
- Missing documents do not invalidate truthful profile claims; they block only
  a route that requires the file at submission time.

### Current implementation

Account creation, resume/manual choice, profile review, preferences, durable
resume state, and completion gating are implemented. A fresh second-account
journey and document-readiness handoff still require end-to-end validation.
