ALTER TABLE application_drafts ADD COLUMN document_packet_slug TEXT NOT NULL DEFAULT '';
ALTER TABLE application_drafts
ADD COLUMN document_packet_manifest_json TEXT NOT NULL DEFAULT '[]'
CHECK (json_valid(document_packet_manifest_json));

ALTER TABLE application_draft_attachments ADD COLUMN category TEXT NOT NULL DEFAULT '';
