-- Additive production hotfix for db_ace4df_floodmonitoring.
-- Select the production database in phpMyAdmin before importing this file.
-- This script creates missing tables only; it does not delete or update rows.

CREATE TABLE IF NOT EXISTS assistance_requests (
  request_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci PRIMARY KEY,
  resident_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  household_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  submitted_by_user_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  kind ENUM('Need help','Safe at home','Reached shelter') NOT NULL,
  location VARCHAR(500) NOT NULL,
  needs VARCHAR(1000) NOT NULL,
  status ENUM('Submitted','Acknowledged','Closed') NOT NULL DEFAULT 'Submitted',
  review_note VARCHAR(1000) NOT NULL DEFAULT '',
  revision INT NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX assistance_resident (resident_id,created_at),
  INDEX assistance_household (household_id,status),
  FOREIGN KEY (resident_id) REFERENCES residents(resident_id),
  FOREIGN KEY (household_id) REFERENCES households(household_id),
  FOREIGN KEY (submitted_by_user_id) REFERENCES users(user_id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS assistance_request_updates (
  update_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  request_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  status VARCHAR(30) NOT NULL,
  note VARCHAR(1000) NOT NULL,
  recorded_by_user_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  FOREIGN KEY (request_id) REFERENCES assistance_requests(request_id),
  FOREIGN KEY (recorded_by_user_id) REFERENCES users(user_id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS household_contacts (
  household_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci PRIMARY KEY,
  status ENUM('Not contacted','Contacted','Needs follow-up') NOT NULL,
  assigned_user_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  note VARCHAR(1000) NOT NULL,
  revision INT NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  FOREIGN KEY (household_id) REFERENCES households(household_id),
  FOREIGN KEY (assigned_user_id) REFERENCES users(user_id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS household_contact_updates (
  update_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  household_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  status VARCHAR(30) NOT NULL,
  assigned_user_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  note VARCHAR(1000) NOT NULL,
  recorded_by_user_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  FOREIGN KEY (household_id) REFERENCES households(household_id),
  FOREIGN KEY (assigned_user_id) REFERENCES users(user_id) ON DELETE SET NULL,
  FOREIGN KEY (recorded_by_user_id) REFERENCES users(user_id) ON DELETE SET NULL
);
