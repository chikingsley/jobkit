ALTER TABLE jobs ADD COLUMN compensation_display TEXT NOT NULL DEFAULT 'Salary not listed';
ALTER TABLE jobs ADD COLUMN compensation_amount_min INTEGER;
ALTER TABLE jobs ADD COLUMN compensation_amount_max INTEGER;
ALTER TABLE jobs ADD COLUMN compensation_currency TEXT;
ALTER TABLE jobs ADD COLUMN compensation_period TEXT CHECK (compensation_period IN ('hour','month','year'));
ALTER TABLE jobs ADD COLUMN compensation_qualifier TEXT CHECK (compensation_qualifier IN ('exact','range','up-to','from'));
ALTER TABLE jobs ADD COLUMN compensation_source TEXT NOT NULL DEFAULT 'unknown' CHECK (compensation_source IN ('listing-field','listing-description','curated-review','unknown'));
ALTER TABLE jobs ADD COLUMN compensation_confidence TEXT NOT NULL DEFAULT 'unknown' CHECK (compensation_confidence IN ('exact','inferred','conflict','unknown'));
ALTER TABLE jobs ADD COLUMN compensation_notes_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(compensation_notes_json));

-- These rows were manually checked against the original listing text during the
-- compensation-source audit. Future imports preserve curated-review values.
UPDATE jobs SET
  compensation_display = '900–950 OMR/month',
  compensation_amount_min = 900,
  compensation_amount_max = 950,
  compensation_currency = 'OMR',
  compensation_period = 'month',
  compensation_qualifier = 'range',
  compensation_source = 'curated-review',
  compensation_confidence = 'exact'
WHERE id = '268901';

UPDATE jobs SET
  compensation_display = '7,500 PLN/month',
  compensation_amount_min = 7500,
  compensation_currency = 'PLN',
  compensation_period = 'month',
  compensation_qualifier = 'exact',
  compensation_source = 'curated-review',
  compensation_confidence = 'exact',
  compensation_notes_json = '["The listing estimates approximately $2,000 USD / €1,750."]'
WHERE id = '273333';

UPDATE jobs SET
  compensation_display = 'Up to 950 OMR/month',
  compensation_amount_max = 950,
  compensation_currency = 'OMR',
  compensation_period = 'month',
  compensation_qualifier = 'up-to',
  compensation_source = 'curated-review',
  compensation_confidence = 'exact',
  compensation_notes_json = '["Base tiers listed: BA 875 OMR; BA + MA 900 OMR; BA + MA + PhD 925 OMR.","Allowances listed: 200 OMR housing and furniture, 44 OMR utilities, and 60 OMR transportation."]'
WHERE id = '274594';

UPDATE jobs SET
  compensation_display = '¥240,000 JPY/month',
  compensation_amount_min = 240000,
  compensation_currency = 'JPY',
  compensation_period = 'month',
  compensation_qualifier = 'exact',
  compensation_source = 'curated-review',
  compensation_confidence = 'exact',
  compensation_notes_json = '["Overtime is listed at ¥2,000 per hour.","Bonuses listed: ¥100,000 on contract completion and ¥120,000 on renewal."]'
WHERE id = '275878';

UPDATE jobs SET
  compensation_display = 'Negotiable',
  compensation_source = 'curated-review',
  compensation_confidence = 'exact'
WHERE id IN ('278664','279778','280312','280321','280366');

UPDATE jobs SET
  compensation_display = '¥240,000 JPY/month',
  compensation_amount_min = 240000,
  compensation_currency = 'JPY',
  compensation_period = 'month',
  compensation_qualifier = 'exact',
  compensation_source = 'curated-review',
  compensation_confidence = 'exact'
WHERE id = '279052';

UPDATE jobs SET
  compensation_display = '900–1,300+/month (currency not listed)',
  compensation_amount_min = 900,
  compensation_amount_max = 1300,
  compensation_period = 'month',
  compensation_qualifier = 'range',
  compensation_source = 'curated-review',
  compensation_confidence = 'unknown'
WHERE id = '279428';

UPDATE jobs SET
  compensation_display = '¥358,500 JPY (salary field says RMB 358,500)',
  compensation_source = 'curated-review',
  compensation_confidence = 'conflict',
  compensation_notes_json = '["The description identifies JPY while the separate salary field identifies RMB; verify the currency with the employer."]'
WHERE id = '280365';
