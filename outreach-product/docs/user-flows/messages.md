# Messages and outcomes

## FLOW-030: Receive a reply and record the outcome

**Actor:** Candidate

**Entry:** Messages, a notification, or an application success action.

### Journey

1. Gmail push notification identifies changed mailbox history.
2. JobKit classifies the event as a human reply, bounce, delivery failure,
   vacation responder, or other automated response. Any person-authored reply
   counts regardless of sentiment or length.
3. JobKit reconciles the affected thread and attributes it to the originating
   job, bundle, campaign target, contact, and attempt.
4. The candidate opens the thread and sees the message with Gmail-equivalent
   paragraph and signature formatting.
5. The candidate replies from JobKit or continues in Gmail.
6. JobKit records a useful outcome such as interested, interview, offer,
   declined, withdrawn, bounced, or no response after the configured window.
7. A follow-up remains attached to the same contact and attempt history.
8. When the campaign reaches its human-reply threshold, JobKit pauses future
   execution and directs the candidate to the conversations.

**Terminal state:** The reply and outcome are attributed to the exact attempt;
the contact and campaign statistics update without overwriting global school
identity.

### Failure and recovery

- Duplicate Pub/Sub delivery is idempotent.
- An expired Gmail watch is renewed without losing thread history.
- A message that cannot be attributed remains visible for operator resolution
  rather than being attached to the wrong application.
