-- 033_print_jobs.sql
-- ============================================================================
-- Coda stampe (best-effort retry)
-- ============================================================================

CREATE TABLE IF NOT EXISTS print_jobs (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  kind VARCHAR(50) NOT NULL,
  order_id BIGINT NULL,
  payload_json TEXT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'queued',
  attempts INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 10,
  next_run_at DATETIME NOT NULL DEFAULT UTC_TIMESTAMP(),
  last_error TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  printed_at DATETIME NULL,
  INDEX idx_print_jobs_status_next (status, next_run_at)
);
