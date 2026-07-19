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

INSERT INTO jobs (
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

INSERT INTO jobs (
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

INSERT INTO user_jobs (
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
