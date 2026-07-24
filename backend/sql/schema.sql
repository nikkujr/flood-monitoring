CREATE DATABASE IF NOT EXISTS bantay_baha CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE bantay_baha;

CREATE TABLE IF NOT EXISTS users (
  user_id CHAR(36) PRIMARY KEY,
  full_name VARCHAR(160) NOT NULL,
  username VARCHAR(80) NOT NULL UNIQUE,
  email VARCHAR(190) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
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
  emergency_contact_name VARCHAR(160) NULL,
  emergency_contact_number VARCHAR(30) NULL,
  priority_level ENUM('Low','Medium','High') NOT NULL DEFAULT 'Low',
  evacuation_status ENUM('Safe','For Monitoring','For Evacuation','Evacuated') NOT NULL DEFAULT 'Safe',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (household_id) REFERENCES households(household_id),
  INDEX residents_duplicate_idx (full_name, date_of_birth, household_id)
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
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (zone_id) REFERENCES zones(zone_id),
  CHECK (current_occupancy <= capacity)
);

CREATE TABLE IF NOT EXISTS volunteers (
  volunteer_id CHAR(36) PRIMARY KEY,
  full_name VARCHAR(160) NOT NULL,
  contact_number VARCHAR(30) NOT NULL,
  email VARCHAR(190) NULL,
  assigned_zone_id CHAR(36) NULL,
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
