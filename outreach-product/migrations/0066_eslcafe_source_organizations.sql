INSERT OR IGNORE INTO organizations (
  id,country_code,country_name,name,identity_key,city,region,website_url,
  canonical_domain,market_segment,status,outreach_eligibility,evidence_url,
  source_sweep_id,last_verified_at,created_at,updated_at
)
SELECT
  'source-org:eslcafe-modern:' || lower(hex(lower(trim(company)))),
  'ZZ',
  'Unspecified',
  trim(company),
  'eslcafe-modern:' || lower(trim(company)),
  '',
  '',
  '',
  '',
  'school',
  'active',
  'review',
  min(source_url),
  NULL,
  max(source_last_seen_at),
  min(first_seen_at),
  max(updated_at)
FROM job_listings
WHERE board = 'eslcafe-modern'
  AND inventory_status = 'active'
  AND trim(company) <> ''
GROUP BY lower(trim(company));

INSERT OR IGNORE INTO organization_opportunities (
  organization_id,job_id,evidence_url,linked_at
)
SELECT
  organization.id,
  listing.id,
  listing.source_url,
  listing.updated_at
FROM job_listings listing
JOIN organizations organization
  ON organization.country_code = 'ZZ'
 AND organization.identity_key =
       'eslcafe-modern:' || lower(trim(listing.company))
WHERE listing.board = 'eslcafe-modern'
  AND listing.inventory_status = 'active'
  AND trim(listing.company) <> '';

INSERT OR IGNORE INTO organization_opportunity_acceptances (
  organization_id,job_id,accepted_by_user_id,accepted_at,created_at
)
SELECT
  opportunity.organization_id,
  opportunity.job_id,
  operator.id,
  opportunity.linked_at,
  opportunity.linked_at
FROM organization_opportunities opportunity
JOIN job_listings listing ON listing.id = opportunity.job_id
JOIN users operator ON operator.id = (
  SELECT id
  FROM users
  WHERE role = 'operator'
  ORDER BY created_at,id
  LIMIT 1
)
WHERE listing.board = 'eslcafe-modern';
