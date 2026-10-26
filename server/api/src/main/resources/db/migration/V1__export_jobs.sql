CREATE TABLE export_jobs (
  id VARCHAR(36) PRIMARY KEY,
  owner_hash VARCHAR(64) NOT NULL,
  request_id VARCHAR(36) NOT NULL,
  state VARCHAR(16) NOT NULL,
  snapshot MEDIUMTEXT NOT NULL,
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  error_message VARCHAR(200),
  UNIQUE (owner_hash, request_id)
);
CREATE INDEX idx_export_expiry ON export_jobs(expires_at);
CREATE INDEX idx_export_queue ON export_jobs(state, created_at);
