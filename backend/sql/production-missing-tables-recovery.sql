-- Additive recovery for the production database selected in phpMyAdmin.
-- Creates the ten application tables absent from the legacy deployment.
-- No DROP, DELETE, UPDATE, INSERT, CREATE DATABASE, or USE statements.
-- Foreign keys are intentionally omitted because the legacy production tables
-- use mixed character sets/collations. Application-level validation remains in place.

CREATE TABLE IF NOT EXISTS rescue_team_members (
  team_id CHAR(36) NOT NULL,
  volunteer_id CHAR(36) NOT NULL,
  PRIMARY KEY(team_id,volunteer_id)
);

CREATE TABLE IF NOT EXISTS rescue_active_responders (
  volunteer_id CHAR(36) PRIMARY KEY,
  mission_id CHAR(36) NOT NULL
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
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS response_action_updates (
  update_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  source_key VARCHAR(60) NOT NULL,
  team_id CHAR(36) NULL,
  status VARCHAR(30) NOT NULL,
  note VARCHAR(1000) NOT NULL,
  recorded_by_user_id CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS assistance_requests (
  request_id CHAR(36) PRIMARY KEY,
  resident_id CHAR(36) NOT NULL,
  household_id CHAR(36) NOT NULL,
  submitted_by_user_id CHAR(36) NULL,
  kind ENUM('Need help','Safe at home','Reached shelter') NOT NULL,
  location VARCHAR(500) NOT NULL,
  needs VARCHAR(1000) NOT NULL,
  status ENUM('Submitted','Acknowledged','Closed') NOT NULL DEFAULT 'Submitted',
  review_note VARCHAR(1000) NOT NULL DEFAULT '',
  revision INT NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX assistance_resident (resident_id,created_at),
  INDEX assistance_household (household_id,status)
);

CREATE TABLE IF NOT EXISTS assistance_request_updates (
  update_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  request_id CHAR(36) NOT NULL,
  status VARCHAR(30) NOT NULL,
  note VARCHAR(1000) NOT NULL,
  recorded_by_user_id CHAR(36) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
);

CREATE TABLE IF NOT EXISTS household_contacts (
  household_id CHAR(36) PRIMARY KEY,
  status ENUM('Not contacted','Contacted','Needs follow-up') NOT NULL,
  assigned_user_id CHAR(36) NULL,
  note VARCHAR(1000) NOT NULL,
  revision INT NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
);

CREATE TABLE IF NOT EXISTS household_contact_updates (
  update_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  household_id CHAR(36) NOT NULL,
  status VARCHAR(30) NOT NULL,
  assigned_user_id CHAR(36) NULL,
  note VARCHAR(1000) NOT NULL,
  recorded_by_user_id CHAR(36) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
);
