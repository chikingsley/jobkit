PRAGMA foreign_keys = ON;

DELETE FROM outbound_recipient_claims
WHERE source_kind='campaign_dispatch'
  AND user_id=(
    SELECT id FROM users WHERE email='maestro.local@jobkit.test'
  );
DELETE FROM campaigns
WHERE user_id=(
  SELECT id FROM users WHERE email='maestro.local@jobkit.test'
);
DELETE FROM campaigns WHERE id='maestro-review-campaign';
DELETE FROM agent_task_requests
WHERE subject_type='campaign_dispatch'
  AND subject_id IN (
    'maestro-review-dispatch-one',
    'maestro-review-dispatch-two'
  );

INSERT INTO job_listings (
  id, board, title, company, country, location, salary, description, source_url,
  apply_url, employer_id, first_seen_at, updated_at, compensation_display,
  compensation_amount_min, compensation_amount_max, compensation_currency,
  compensation_period, compensation_qualifier, compensation_source,
  compensation_confidence, compensation_notes_json, opportunity_scope,
  market_segments_json, message_route, contact_name, source_reference
) VALUES (
  'maestro-job-poland', 'fixture', 'Maestro English Teacher',
  'Maestro International School', 'Poland', 'Warsaw, Poland',
  '12000 PLN monthly', 'Safe local browser-flow fixture.',
  'https://example.test/jobs/maestro-poland',
  'mailto:maestro-school@example.test', 'maestro-school',
  '2026-07-18T00:00:00.000Z', '2026-07-18T00:00:00.000Z',
  '12000 PLN monthly', 12000, 12000, 'PLN', 'month', 'exact',
  'curated-review', 'exact', '[]', 'direct',
  '["international_school"]', 'advertised_position', '',
  'MAESTRO-POLAND-001'
) ON CONFLICT(id) DO UPDATE SET
  title=excluded.title,
  updated_at=excluded.updated_at;

INSERT INTO job_listings (
  id, board, title, company, country, location, salary, description, source_url,
  apply_url, employer_id, first_seen_at, updated_at, compensation_display,
  compensation_amount_min, compensation_amount_max, compensation_currency,
  compensation_period, compensation_qualifier, compensation_source,
  compensation_confidence, compensation_notes_json, opportunity_scope,
  market_segments_json, message_route, contact_name, source_reference
) VALUES (
  'maestro-job-anesl', 'anesl', 'Maestro University English Lecturer',
  'ANESL fixture', 'China', 'Beijing, China', '26000 CNY monthly',
  'Safe local ANESL selection fixture.',
  'https://example.test/jobs/maestro-anesl',
  'mailto:hr@anesl.com', 'anesl-fixture',
  '2026-07-18T00:00:00.000Z', '2026-07-18T00:00:00.000Z',
  '26000 CNY monthly', 26000, 26000, 'CNY', 'month', 'exact',
  'curated-review', 'exact', '[]', 'direct', '["university"]',
  'advertised_position', 'Mr. Corey Yang', 'MAESTRO-ANESL-001'
) ON CONFLICT(id) DO UPDATE SET
  title=excluded.title,
  updated_at=excluded.updated_at;

INSERT INTO application_routes (
  id, job_id, kind, destination, source_evidence, last_verified_at, status,
  created_at, updated_at
) VALUES
  (
    'maestro-route-poland', 'maestro-job-poland', 'email',
    'maestro-school@example.test', 'Local Maestro fixture',
    '2026-07-18T00:00:00.000Z', 'active', '2026-07-18T00:00:00.000Z',
    '2026-07-18T00:00:00.000Z'
  ),
  (
    'maestro-route-anesl', 'maestro-job-anesl', 'email', 'hr@anesl.com',
    'Local Maestro fixture', '2026-07-18T00:00:00.000Z', 'active',
    '2026-07-18T00:00:00.000Z', '2026-07-18T00:00:00.000Z'
  )
ON CONFLICT(job_id, kind, destination) DO UPDATE SET
  status=excluded.status,
  updated_at=excluded.updated_at;

INSERT INTO organizations (
  id, country_code, country_name, name, identity_key, city, region,
  website_url, canonical_domain, market_segment, status,
  outreach_eligibility, evidence_url, last_verified_at, created_at, updated_at
) VALUES (
  'maestro-organization-poland', 'PL', 'Poland',
  'Maestro International School', 'maestro-international-school-warsaw',
  'Warsaw', 'Masovian', 'https://example.test/maestro-school',
  'example.test', 'international_school', 'active', 'eligible',
  'https://example.test/maestro-school', '2026-07-18T00:00:00.000Z',
  '2026-07-18T00:00:00.000Z', '2026-07-18T00:00:00.000Z'
) ON CONFLICT(id) DO UPDATE SET
  status=excluded.status,
  outreach_eligibility=excluded.outreach_eligibility,
  updated_at=excluded.updated_at;

INSERT INTO organization_contact_points (
  id, organization_id, kind, label, value, status, evidence_url,
  last_verified_at, created_at, updated_at
) VALUES (
  'maestro-contact-poland', 'maestro-organization-poland', 'email',
  'Recruiting', 'maestro-school@example.test', 'active',
  'https://example.test/maestro-school', '2026-07-18T00:00:00.000Z',
  '2026-07-18T00:00:00.000Z', '2026-07-18T00:00:00.000Z'
) ON CONFLICT(organization_id, kind, value) DO UPDATE SET
  status=excluded.status,
  updated_at=excluded.updated_at;

INSERT INTO user_listing_states (
  id, user_id, job_id, status, priority, created_at, updated_at
)
SELECT
  'maestro-user-job-poland', id, 'maestro-job-poland', 'new', 100,
  '2026-07-18T00:00:00.000Z', '2026-07-18T00:00:00.000Z'
FROM users
WHERE email='maestro.local@jobkit.test'
ON CONFLICT(user_id, job_id) DO UPDATE SET
  status='new',
  priority=100,
  updated_at='2026-07-18T00:00:00.000Z';

INSERT INTO campaigns (
  id, user_id, name, status, daily_pace, stop_after_human_replies,
  posted_target_percent, first_five_required, human_reply_count,
  policy_snapshot_json, pause_reason, created_at, updated_at
)
SELECT
  'maestro-review-campaign', id, 'Review interaction fixture', 'calibrating',
  5, 3, 50, 1, 0, '{}', '', '2026-07-18T01:00:00.000Z',
  '2026-07-18T01:00:00.000Z'
FROM users
WHERE id='local-development-user';

INSERT INTO campaign_markets (
  campaign_id, country_code, country_name, added_at
) VALUES
  ('maestro-review-campaign', 'PL', 'Poland', '2026-07-18T01:00:00.000Z'),
  ('maestro-review-campaign', 'CN', 'China', '2026-07-18T01:00:00.000Z');

INSERT INTO campaign_targets (
  id, campaign_id, country_code, source_kind, subject_kind, subject_id, job_id,
  route_id, channel, route_strategy, dedup_key, status, hold_reason,
  match_label, match_score, match_snapshot_json, admitted_at, updated_at
) VALUES
  (
    'maestro-review-target-one', 'maestro-review-campaign', 'PL',
    'advertised', 'job', 'maestro-job-poland', 'maestro-job-poland',
    'maestro-route-poland', 'email', 'single',
    'email:maestro-school@example.test', 'drafted', '', 'Strong match', 92,
    '{}', '2026-07-18T01:00:00.000Z', '2026-07-18T01:00:00.000Z'
  ),
  (
    'maestro-review-target-two', 'maestro-review-campaign', 'CN',
    'advertised', 'job', 'maestro-job-anesl', 'maestro-job-anesl',
    'maestro-route-anesl', 'email', 'single', 'email:hr@anesl.com', 'drafted',
    '', 'Strong match', 88, '{}', '2026-07-18T01:00:00.000Z',
    '2026-07-18T01:00:00.000Z'
  );

INSERT INTO campaign_dispatches (
  id, campaign_id, dedup_key, route_strategy, channel, recipient, subject,
  status, created_at, updated_at
) VALUES
  (
    'maestro-review-dispatch-one', 'maestro-review-campaign',
    'email:maestro-school@example.test', 'single', 'email',
    'maestro-school@example.test', 'Native English Teacher Available - Warsaw',
    'review', '2026-07-18T01:01:00.000Z', '2026-07-18T01:01:00.000Z'
  ),
  (
    'maestro-review-dispatch-two', 'maestro-review-campaign',
    'email:hr@anesl.com', 'single', 'email', 'hr@anesl.com',
    'Native English Teacher Available - Beijing', 'review',
    '2026-07-18T01:02:00.000Z', '2026-07-18T01:02:00.000Z'
  );

INSERT INTO campaign_dispatch_targets (dispatch_id, target_id, ordinal) VALUES
  ('maestro-review-dispatch-one', 'maestro-review-target-one', 0),
  ('maestro-review-dispatch-two', 'maestro-review-target-two', 0);

INSERT INTO campaign_messages (
  id, dispatch_id, version, message, change_summary, revision_instruction,
  revision_source, status, model_id, created_at
) VALUES
  (
    'maestro-review-message-one-v1', 'maestro-review-dispatch-one', 1,
    'Hello,

I have taught English to adult learners in several settings. I also work in engineering.

Would you be open to talking about your teaching needs?

Best,
Maestro Local',
    'Prepared the first review version.', '', 'generated', 'superseded',
    'gpt-5.6-luna', '2026-07-18T01:01:00.000Z'
  ),
  (
    'maestro-review-message-one-v2', 'maestro-review-dispatch-one', 2,
    'Hello,

I have taught English to adult learners in classroom and one-to-one settings.

Would you be open to talking about your teaching needs?

Best,
Maestro Local',
    'Removed the unrelated engineering sentence.',
    'Remove the engineering sentence.', 'ai_revision', 'draft',
    'gpt-5.6-terra', '2026-07-18T01:03:00.000Z'
  ),
  (
    'maestro-review-message-two-v1', 'maestro-review-dispatch-two', 1,
    'Hello Mr. Yang,

I have taught English to adult learners and university students.

Would you be open to talking about the role?

Best,
Maestro Local',
    'Tailored the message to adult and university teaching.', '', 'generated',
    'draft', 'gpt-5.6-luna', '2026-07-18T01:02:00.000Z'
  );

INSERT INTO campaign_guidance (
  id, campaign_id, source_dispatch_id, instruction, scope, status, created_at,
  decided_at
) VALUES (
  'maestro-review-guidance', 'maestro-review-campaign',
  'maestro-review-dispatch-one',
  'Keep secondary experience brief and tied to the teaching role.', 'campaign',
  'accepted', '2026-07-18T01:03:00.000Z', '2026-07-18T01:03:00.000Z'
);
