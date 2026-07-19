# Applications

## FLOW-010: Review and send one email application

**Actor:** Candidate

**Entry:** A selected job in the Jobs workspace with an active email route.

### Email journey

1. Review the complete listing, extracted requirements, match evidence, and
   recipient.
2. Resolve any candidate fact that materially affects eligibility.
3. Inspect the proposed document packet and exact document versions.
4. Generate or open the current message draft.
5. Review or revise the subject and body. A revision creates a new immutable
   version and keeps the changed text visible.
6. Press Send once for the exact message version, recipient, and packet.
7. JobKit creates the Gmail payload, sends it, and verifies Gmail state.
8. The item leaves the review queue and becomes visible in Messages.

**Terminal state:** Gmail confirms the sent message and JobKit records the
recipient, message version, packet, Gmail identifiers, and attempt state.

## FLOW-011: Complete an external or supported form

**Actor:** Candidate

**Entry:** A selected job whose active route is an external URL, login-gated
form, or a board form supported by a JobKit executor.

### Form journey

1. Review the same listing, match, requirement, and document information used
   for an email application.
2. Open the external destination, or review the exact supported form payload.
3. Complete the destination flow.
4. Confirm submission only after the destination provides a success signal.

**Terminal state:** JobKit stores the route, submission time, executor or manual
confirmation, and any authoritative destination reference.

This flow does not mean that every external page is automated. Unsupported or
login-gated destinations remain user-completed while JobKit preserves the state
and evidence.

## FLOW-012: Route and send one ANESL application bundle

**Actor:** JobKit acting under the candidate's campaign policy

**Entry:** Eligible ANESL positions from the campaign's selected markets reach
the shared execution gate.

### ANESL journey

1. Rank currently eligible, unsent ANESL positions for the campaign's markets.
2. Select the strongest one to five compatible position references according
   to ANESL's intermediary instructions.
3. Create one bundle with a shared recipient, subject, message, and frozen
   packet.
4. Include the bundle in first-five calibration when it is among the first
   campaign executions; otherwise apply the calibrated campaign policy.
5. Claim the bundle and every included reference before sending so another
   campaign cannot race or duplicate it.
6. Send one email representing the complete bundle.
7. Show the bundle, references, and Gmail thread in campaign activity and
   Messages.

**Terminal state:** Gmail confirms one sent message, and the bundle and each
selected position point to the same attempt/thread.

ANESL is an execution route rather than a top-level candidate workspace. A
manual override may inspect or hold the generated bundle from the campaign,
but the candidate does not need to assemble it in a separate product area.

## Shared application rules

- The candidate always sees the complete listing before action.
- The recipient, subject, message version, and packet are explicit.
- One visible Send action owns draft creation, send, and verification.
- Destination state is authoritative for success.
- Deduplication prevents repeated submission of the same approved version.
