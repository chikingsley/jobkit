ALTER TABLE user_documents ADD COLUMN r2_version TEXT NOT NULL DEFAULT '';
ALTER TABLE user_documents ADD COLUMN etag TEXT NOT NULL DEFAULT '';
ALTER TABLE user_documents ADD COLUMN archived_at TEXT;

CREATE TABLE user_document_packets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug TEXT NOT NULL CHECK (slug IN ('english-teaching-core','visa-market')),
  name TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id,slug)
);

CREATE UNIQUE INDEX idx_user_document_packets_one_default
  ON user_document_packets(user_id) WHERE is_default=1;

ALTER TABLE application_drafts
ADD COLUMN document_packet_id TEXT REFERENCES user_document_packets(id) ON DELETE SET NULL;
ALTER TABLE application_drafts ADD COLUMN document_packet_name TEXT NOT NULL DEFAULT '';

CREATE TABLE user_document_packet_items (
  packet_id TEXT NOT NULL REFERENCES user_document_packets(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  document_id TEXT NOT NULL REFERENCES user_documents(id) ON DELETE RESTRICT,
  position INTEGER NOT NULL CHECK (position >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(packet_id,category),
  UNIQUE(packet_id,document_id),
  UNIQUE(packet_id,position)
);

CREATE INDEX idx_user_document_packet_items_document
  ON user_document_packet_items(document_id);

CREATE TABLE application_draft_attachments (
  draft_id TEXT NOT NULL REFERENCES application_drafts(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 0),
  source_document_id TEXT NOT NULL REFERENCES user_documents(id) ON DELETE RESTRICT,
  filename TEXT NOT NULL,
  object_key TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  r2_version TEXT NOT NULL,
  etag TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(draft_id,position),
  UNIQUE(draft_id,source_document_id)
);

CREATE INDEX idx_application_draft_attachments_document
  ON application_draft_attachments(source_document_id);

CREATE TABLE user_qualification_claims (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  claim_key TEXT NOT NULL,
  label TEXT NOT NULL,
  kind TEXT NOT NULL,
  answer TEXT NOT NULL CHECK (answer IN ('yes','no')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(user_id,claim_key)
);

CREATE TABLE user_message_style_choices (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  comparison_id TEXT NOT NULL,
  choice TEXT NOT NULL CHECK (choice IN ('a','b','equal')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(user_id,comparison_id)
);
