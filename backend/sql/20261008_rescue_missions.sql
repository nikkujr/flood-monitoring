CREATE TABLE IF NOT EXISTS rescue_teams (
  team_id CHAR(36) PRIMARY KEY,
  name VARCHAR(120) NOT NULL UNIQUE,
  leader VARCHAR(120) NOT NULL,
  contact VARCHAR(80) NOT NULL,
  vehicle VARCHAR(120) NULL UNIQUE,
  passenger_capacity INT NOT NULL,
  availability ENUM('Available','Out of service') NOT NULL DEFAULT 'Available',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS rescue_missions (
  mission_id CHAR(36) PRIMARY KEY,
  team_id CHAR(36) NOT NULL,
  shelter_id CHAR(36) NOT NULL,
  pickup VARCHAR(500) NOT NULL,
  instructions VARCHAR(1000) NOT NULL,
  status ENUM('Dispatched','At pickup','Transporting','Blocked','Arrived','Cancelled') NOT NULL,
  revision INT NOT NULL DEFAULT 1,
  residents JSON NOT NULL,
  team_snapshot JSON NOT NULL,
  shelter_name VARCHAR(160) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  arrived_at DATETIME(3) NULL,
  INDEX rescue_team_status (team_id,status),
  FOREIGN KEY (team_id) REFERENCES rescue_teams(team_id)
);
CREATE TABLE IF NOT EXISTS rescue_active_residents (
  resident_id CHAR(36) PRIMARY KEY,
  mission_id CHAR(36) NOT NULL,
  INDEX rescue_active_mission (mission_id),
  FOREIGN KEY (mission_id) REFERENCES rescue_missions(mission_id)
);
CREATE TABLE IF NOT EXISTS rescue_updates (
  update_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  mission_id CHAR(36) NOT NULL,
  status VARCHAR(32) NOT NULL,
  note VARCHAR(1000) NOT NULL,
  recorded_by_user_id CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  FOREIGN KEY (mission_id) REFERENCES rescue_missions(mission_id)
);
