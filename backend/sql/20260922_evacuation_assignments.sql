-- Safe production upgrade for resident evacuation assignments.
-- This preserves existing records and can be run more than once.
CREATE TABLE IF NOT EXISTS evacuation_assignments (
  assignment_id CHAR(36) PRIMARY KEY,
  resident_id CHAR(36) NOT NULL,
  shelter_id CHAR(36) NULL,
  action ENUM('Assigned','Transferred','Returned Home') NOT NULL,
  evacuation_at DATETIME NOT NULL,
  recorded_by_user_id CHAR(36) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX evacuation_assignment_resident_idx (resident_id, created_at),
  INDEX evacuation_assignment_shelter_idx (shelter_id, created_at)
);
