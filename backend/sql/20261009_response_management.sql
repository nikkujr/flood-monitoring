CREATE TABLE IF NOT EXISTS response_actions (
  source_key VARCHAR(60) PRIMARY KEY,
  target_label VARCHAR(255) NOT NULL,
  priority VARCHAR(20) NOT NULL,
  response_action TEXT NOT NULL,
  basis TEXT NOT NULL,
  team_id CHAR(36) NULL,
  status ENUM('For Review','Pending','In Progress','Completed') NOT NULL DEFAULT 'For Review',
  latest_update VARCHAR(1000) NOT NULL DEFAULT 'Awaiting official review',
  revision INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (team_id) REFERENCES rescue_teams(team_id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS response_action_updates (
  update_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  source_key VARCHAR(60) NOT NULL,
  team_id CHAR(36) NULL,
  status VARCHAR(30) NOT NULL,
  note VARCHAR(1000) NOT NULL,
  recorded_by_user_id CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (source_key) REFERENCES response_actions(source_key),
  FOREIGN KEY (team_id) REFERENCES rescue_teams(team_id) ON DELETE SET NULL,
  FOREIGN KEY (recorded_by_user_id) REFERENCES users(user_id) ON DELETE SET NULL
);
