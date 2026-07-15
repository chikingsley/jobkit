ALTER TABLE application_attempts ADD COLUMN send_requested_at TEXT;

CREATE INDEX idx_application_attempts_send_requests
  ON application_attempts(status,send_requested_at,updated_at);
