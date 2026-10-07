CREATE TABLE IF NOT EXISTS flood_report_reviews (
  review_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  report_id CHAR(36) NOT NULL,
  from_status VARCHAR(32) NOT NULL,
  to_status VARCHAR(32) NOT NULL,
  severity_level VARCHAR(32) NOT NULL,
  notes TEXT NOT NULL,
  affected_zones JSON NOT NULL,
  reviewer_user_id CHAR(36) NULL,
  reviewer_name VARCHAR(160) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  FOREIGN KEY (report_id) REFERENCES flood_reports(report_id) ON DELETE CASCADE,
  FOREIGN KEY (reviewer_user_id) REFERENCES users(user_id) ON DELETE SET NULL
);
