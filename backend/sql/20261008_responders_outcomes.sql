CREATE TABLE IF NOT EXISTS rescue_team_members (
  team_id CHAR(36) NOT NULL,
  volunteer_id CHAR(36) NOT NULL,
  PRIMARY KEY(team_id,volunteer_id),
  FOREIGN KEY(team_id) REFERENCES rescue_teams(team_id),
  FOREIGN KEY(volunteer_id) REFERENCES volunteers(volunteer_id)
);
CREATE TABLE IF NOT EXISTS rescue_active_responders (
  volunteer_id CHAR(36) PRIMARY KEY,
  mission_id CHAR(36) NOT NULL,
  FOREIGN KEY(volunteer_id) REFERENCES volunteers(volunteer_id),
  FOREIGN KEY(mission_id) REFERENCES rescue_missions(mission_id)
);
CREATE TABLE IF NOT EXISTS resident_outcomes (
  resident_id CHAR(36) PRIMARY KEY,
  outcome ENUM('Missing','Deceased','Located') NOT NULL,
  revision INT NOT NULL,
  source VARCHAR(240) NOT NULL,
  notes VARCHAR(1000) NOT NULL,
  last_seen_location VARCHAR(500) NOT NULL,
  observed_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS resident_outcome_updates (
  update_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  resident_id CHAR(36) NOT NULL,
  resident_name VARCHAR(160) NOT NULL,
  outcome VARCHAR(30) NOT NULL,
  source VARCHAR(240) NOT NULL,
  notes VARCHAR(1000) NOT NULL,
  last_seen_location VARCHAR(500) NOT NULL,
  observed_at DATETIME NOT NULL,
  recorded_by_user_id CHAR(36) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
