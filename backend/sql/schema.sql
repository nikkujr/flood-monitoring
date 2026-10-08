CREATE DATABASE IF NOT EXISTS bantay_baha CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE bantay_baha;

CREATE TABLE IF NOT EXISTS users (
  user_id CHAR(36) PRIMARY KEY,
  full_name VARCHAR(160) NOT NULL,
  username VARCHAR(80) NOT NULL UNIQUE,
  email VARCHAR(190) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  credential_version INT NOT NULL DEFAULT 0,
  role ENUM('Super Admin','Disaster Officer','Data Encoder') NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  refresh_token_id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at DATETIME NOT NULL,
  revoked_at DATETIME NULL,
  replaced_by_token_id CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(user_id)
);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  password_reset_token_id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at DATETIME NOT NULL,
  used_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(user_id)
);

CREATE TABLE IF NOT EXISTS zones (
  zone_id CHAR(36) PRIMARY KEY,
  zone_name VARCHAR(120) NOT NULL UNIQUE,
  zone_color CHAR(7) NOT NULL DEFAULT '#1764C1',
  risk_level ENUM('Low','Medium','High') NULL,
  polygon_geojson JSON NOT NULL,
  description TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS risk_zones (
  risk_zone_id CHAR(36) PRIMARY KEY,
  risk_zone_name VARCHAR(120) NOT NULL UNIQUE,
  risk_level ENUM('Low','Medium','High') NOT NULL,
  polygon_geojson JSON NOT NULL,
  description TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS households (
  household_id CHAR(36) PRIMARY KEY,
  household_number VARCHAR(80) NOT NULL UNIQUE,
  zone_id CHAR(36) NOT NULL,
  address_line VARCHAR(255) NOT NULL,
  head_of_household_name VARCHAR(160) NOT NULL,
  contact_number VARCHAR(30) NULL,
  verification_status ENUM('Pending Verification','Verified','Rejected') NOT NULL DEFAULT 'Pending Verification',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (zone_id) REFERENCES zones(zone_id)
);

CREATE TABLE IF NOT EXISTS residents (
  resident_id CHAR(36) PRIMARY KEY,
  household_id CHAR(36) NOT NULL,
  full_name VARCHAR(160) NOT NULL,
  date_of_birth DATE NOT NULL,
  sex VARCHAR(40) NOT NULL,
  contact_number VARCHAR(30) NULL,
  address_line VARCHAR(255) NOT NULL,
  vulnerability_type VARCHAR(100) NULL,
  vulnerability_other VARCHAR(160) NULL,
  relationship_to_head VARCHAR(60) NULL,
  relationship_other VARCHAR(160) NULL,
  marital_status VARCHAR(30) NULL,
  out_of_school_youth VARCHAR(5) NULL,
  occupation VARCHAR(160) NULL,
  education VARCHAR(160) NULL,
  philsys_number VARCHAR(80) NULL,
  philhealth_number VARCHAR(80) NULL,
  fp_use VARCHAR(5) NULL,
  unmet_needs VARCHAR(5) NULL,
  pwd_specify VARCHAR(160) NULL,
  solo_parent VARCHAR(5) NULL,
  morbidity VARCHAR(160) NULL,
  water_source_level VARCHAR(5) NULL,
  sanitary_toilet VARCHAR(10) NULL,
  can_swim VARCHAR(3) NULL,
  house_type VARCHAR(20) NULL,
  emergency_contact_name VARCHAR(160) NULL,
  emergency_contact_number VARCHAR(30) NULL,
  priority_level ENUM('Low','Medium','High') NOT NULL DEFAULT 'Low',
  evacuation_status ENUM('Safe','For Monitoring','For Evacuation','Evacuated') NOT NULL DEFAULT 'Safe',
  record_status ENUM('Active','Inactive') NOT NULL DEFAULT 'Active',
  evacuation_shelter_id CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (household_id) REFERENCES households(household_id),
  INDEX residents_duplicate_idx (full_name, date_of_birth, household_id),
  INDEX residents_shelter_idx (evacuation_shelter_id)
);

CREATE TABLE IF NOT EXISTS flood_reports (
  report_id CHAR(36) PRIMARY KEY,
  tracking_code VARCHAR(32) NOT NULL UNIQUE,
  reporter_name VARCHAR(160) NULL,
  reporter_contact_info VARCHAR(190) NULL,
  location_text VARCHAR(255) NOT NULL,
  incident_type ENUM('River Flooding','Flash Flood','Road Flooding','Drainage Overflow','Rising Water','Other') NOT NULL DEFAULT 'Other',
  latitude DECIMAL(10,7) NOT NULL,
  longitude DECIMAL(10,7) NOT NULL,
  description TEXT NOT NULL,
  photo_urls JSON NOT NULL,
  severity_level ENUM('Information','Minor Incident','Major Incident') NOT NULL DEFAULT 'Information',
  status ENUM('Submitted','Under Review','Validated','Rejected','Resolved') NOT NULL DEFAULT 'Submitted',
  validation_notes TEXT NULL,
  validated_by_user_id CHAR(36) NULL,
  validated_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (validated_by_user_id) REFERENCES users(user_id)
);

CREATE TABLE IF NOT EXISTS flood_report_zones (
  report_id CHAR(36) NOT NULL,
  zone_id CHAR(36) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (report_id, zone_id),
  FOREIGN KEY (report_id) REFERENCES flood_reports(report_id),
  FOREIGN KEY (zone_id) REFERENCES zones(zone_id)
);

CREATE TABLE IF NOT EXISTS shelters (
  shelter_id CHAR(36) PRIMARY KEY,
  shelter_name VARCHAR(160) NOT NULL,
  zone_id CHAR(36) NOT NULL,
  location_text VARCHAR(255) NOT NULL,
  latitude DECIMAL(10,7) NOT NULL,
  longitude DECIMAL(10,7) NOT NULL,
  capacity INT UNSIGNED NOT NULL,
  current_occupancy INT UNSIGNED NOT NULL DEFAULT 0,
  contact_person VARCHAR(160) NOT NULL,
  contact_number VARCHAR(30) NOT NULL,
  email VARCHAR(190) NULL,
  status ENUM('Available','Near Capacity','Full','Unavailable') NOT NULL DEFAULT 'Available',
  record_status ENUM('Active','Inactive') NOT NULL DEFAULT 'Active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (zone_id) REFERENCES zones(zone_id),
  CHECK (current_occupancy <= capacity)
);

CREATE TABLE IF NOT EXISTS household_year_snapshots (
  snapshot_year SMALLINT UNSIGNED NOT NULL,
  household_id CHAR(36) NOT NULL,
  household_number VARCHAR(80) NOT NULL,
  zone_id CHAR(36) NOT NULL,
  zone_name VARCHAR(120) NOT NULL,
  address_line VARCHAR(255) NOT NULL,
  head_of_household_name VARCHAR(160) NOT NULL,
  contact_number VARCHAR(30) NULL,
  verification_status VARCHAR(40) NOT NULL,
  captured_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (snapshot_year, household_id),
  INDEX household_snapshot_year_number_idx (snapshot_year, household_number),
  INDEX household_snapshot_year_zone_idx (snapshot_year, zone_id)
);

CREATE TABLE IF NOT EXISTS resident_year_snapshots (
  snapshot_year SMALLINT UNSIGNED NOT NULL,
  resident_id CHAR(36) NOT NULL,
  household_id CHAR(36) NOT NULL,
  household_number VARCHAR(80) NOT NULL,
  zone_id CHAR(36) NOT NULL,
  zone_name VARCHAR(120) NOT NULL,
  household_address VARCHAR(255) NOT NULL,
  head_of_household_name VARCHAR(160) NOT NULL,
  full_name VARCHAR(160) NOT NULL,
  date_of_birth DATE NOT NULL,
  sex VARCHAR(40) NOT NULL,
  contact_number VARCHAR(30) NULL,
  address_line VARCHAR(255) NOT NULL,
  vulnerability_type VARCHAR(100) NULL,
  vulnerability_other VARCHAR(160) NULL,
  relationship_to_head VARCHAR(60) NULL,
  relationship_other VARCHAR(160) NULL,
  marital_status VARCHAR(30) NULL,
  out_of_school_youth VARCHAR(5) NULL,
  occupation VARCHAR(160) NULL,
  education VARCHAR(160) NULL,
  philsys_number VARCHAR(80) NULL,
  philhealth_number VARCHAR(80) NULL,
  fp_use VARCHAR(5) NULL,
  unmet_needs VARCHAR(5) NULL,
  pwd_specify VARCHAR(160) NULL,
  solo_parent VARCHAR(5) NULL,
  morbidity VARCHAR(160) NULL,
  water_source_level VARCHAR(5) NULL,
  sanitary_toilet VARCHAR(10) NULL,
  can_swim VARCHAR(3) NULL,
  house_type VARCHAR(20) NULL,
  emergency_contact_name VARCHAR(160) NULL,
  emergency_contact_number VARCHAR(30) NULL,
  priority_level VARCHAR(20) NOT NULL,
  evacuation_status VARCHAR(40) NOT NULL,
  record_status VARCHAR(20) NOT NULL,
  evacuation_shelter_id CHAR(36) NULL,
  source_created_at DATETIME NOT NULL,
  source_updated_at DATETIME NOT NULL,
  captured_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (snapshot_year, resident_id),
  INDEX resident_snapshot_year_household_idx (snapshot_year, household_id),
  INDEX resident_snapshot_year_zone_idx (snapshot_year, zone_id),
  INDEX resident_snapshot_year_name_idx (snapshot_year, full_name)
);

CREATE TABLE IF NOT EXISTS evacuation_assignments (
  assignment_id CHAR(36) PRIMARY KEY,
  resident_id CHAR(36) NOT NULL,
  shelter_id CHAR(36) NULL,
  action ENUM('Assigned','Transferred','Returned Home') NOT NULL,
  evacuation_at DATETIME NOT NULL,
  recorded_by_user_id CHAR(36) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (resident_id) REFERENCES residents(resident_id),
  FOREIGN KEY (shelter_id) REFERENCES shelters(shelter_id),
  FOREIGN KEY (recorded_by_user_id) REFERENCES users(user_id),
  INDEX evacuation_assignment_resident_idx (resident_id, created_at),
  INDEX evacuation_assignment_shelter_idx (shelter_id, created_at)
);

CREATE TABLE IF NOT EXISTS volunteers (
  volunteer_id CHAR(36) PRIMARY KEY,
  full_name VARCHAR(160) NOT NULL,
  contact_number VARCHAR(30) NOT NULL,
  email VARCHAR(190) NULL,
  assigned_zone_id CHAR(36) NULL,
  responder_type ENUM('Volunteer','Barangay Tanod') NOT NULL DEFAULT 'Volunteer',
  availability_status ENUM('Available','Assigned','Unavailable') NOT NULL DEFAULT 'Available',
  notes TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (assigned_zone_id) REFERENCES zones(zone_id)
);

CREATE TABLE IF NOT EXISTS evacuation_routes (
  route_id CHAR(36) PRIMARY KEY,
  route_name VARCHAR(160) NOT NULL,
  origin_zone_id CHAR(36) NOT NULL,
  destination_shelter_id CHAR(36) NOT NULL,
  route_geojson JSON NOT NULL,
  status ENUM('Open','Limited','Closed') NOT NULL DEFAULT 'Open',
  description TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (origin_zone_id) REFERENCES zones(zone_id),
  FOREIGN KEY (destination_shelter_id) REFERENCES shelters(shelter_id)
);

CREATE TABLE IF NOT EXISTS emergency_contacts (
  emergency_contact_id CHAR(36) PRIMARY KEY,
  organization_name VARCHAR(160) NOT NULL,
  contact_person VARCHAR(160) NULL,
  phone_number VARCHAR(30) NOT NULL,
  email VARCHAR(190) NULL,
  is_public BOOLEAN NOT NULL DEFAULT TRUE,
  status ENUM('Active','Inactive') NOT NULL DEFAULT 'Active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS notifications (
  notification_id CHAR(36) PRIMARY KEY,
  flood_report_id CHAR(36) NULL,
  title VARCHAR(180) NOT NULL,
  message TEXT NOT NULL,
  type VARCHAR(80) NOT NULL,
  severity_level ENUM('Information','Minor Incident','Major Incident') NOT NULL,
  target_audience ENUM('Public','Affected Zones','Internal Admin Users') NOT NULL,
  delivery_channel ENUM('In App') NOT NULL DEFAULT 'In App',
  status ENUM('Draft','Sent','Archived') NOT NULL DEFAULT 'Draft',
  sent_by_user_id CHAR(36) NULL,
  sent_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (flood_report_id) REFERENCES flood_reports(report_id),
  FOREIGN KEY (sent_by_user_id) REFERENCES users(user_id)
);

CREATE TABLE IF NOT EXISTS notification_target_zones (
  notification_id CHAR(36) NOT NULL,
  zone_id CHAR(36) NOT NULL,
  PRIMARY KEY (notification_id, zone_id),
  FOREIGN KEY (notification_id) REFERENCES notifications(notification_id),
  FOREIGN KEY (zone_id) REFERENCES zones(zone_id)
);

CREATE TABLE IF NOT EXISTS notification_read_receipts (
  notification_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  read_at DATETIME NOT NULL,
  PRIMARY KEY (notification_id, user_id),
  FOREIGN KEY (notification_id) REFERENCES notifications(notification_id),
  FOREIGN KEY (user_id) REFERENCES users(user_id)
);

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
CREATE TABLE IF NOT EXISTS rescue_teams (
  team_id CHAR(36) PRIMARY KEY,
  name VARCHAR(120) NOT NULL UNIQUE,
  leader VARCHAR(120) NOT NULL,
  leader_id CHAR(36) NULL,
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
