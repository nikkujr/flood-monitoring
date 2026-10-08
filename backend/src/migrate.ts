import { readFile } from "node:fs/promises";
import mysql from "mysql2/promise";
import { config } from "./config.js";

if (!process.env.DATABASE_URL) {
  throw new Error("Set DATABASE_URL explicitly before running the production migration.");
}

const databaseUrl = new URL(config.databaseUrl);
const databaseName = decodeURIComponent(databaseUrl.pathname.replace(/^\//, ""));
if (!/^[a-zA-Z0-9_]+$/.test(databaseName)) {
  throw new Error("DATABASE_URL must contain a safe database name");
}

const connection = await mysql.createConnection({
  host: databaseUrl.hostname,
  port: Number(databaseUrl.port || 3306),
  user: decodeURIComponent(databaseUrl.username),
  password: decodeURIComponent(databaseUrl.password),
  multipleStatements: true
});

try {
  const [existingDatabase] = await connection.query<mysql.RowDataPacket[]>(
    "SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?",
    [databaseName]
  );
  if (!existingDatabase.length) {
    throw new Error(`Database "${databaseName}" does not exist. Check DATABASE_URL before migrating.`);
  }
  const [existingUsers] = await connection.query<mysql.RowDataPacket[]>(
    "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME='users'",
    [databaseName]
  );
  if (!existingUsers.length) {
    throw new Error(`Database "${databaseName}" has no users table. Check DATABASE_URL before migrating.`);
  }

  const schemaTemplate = await readFile(new URL("../sql/schema.sql", import.meta.url), "utf8");
  const schema = schemaTemplate
    .replace("CREATE DATABASE IF NOT EXISTS bantay_baha", `CREATE DATABASE IF NOT EXISTS \`${databaseName}\``)
    .replace("USE bantay_baha;", `USE \`${databaseName}\`;`);
  await connection.query(schema);
  await connection.query(`ALTER TABLE \`${databaseName}\`.users MODIFY role ENUM('Super Admin','Disaster Officer','Data Encoder','Resident','Secretary') NOT NULL`);
  const [reporterColumns] = await connection.query<mysql.RowDataPacket[]>(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME='flood_reports' AND COLUMN_NAME='reporter_user_id'", [databaseName]
  );
  if (!reporterColumns.length) await connection.query(`ALTER TABLE \`${databaseName}\`.flood_reports ADD COLUMN reporter_user_id CHAR(36) NULL, ADD FOREIGN KEY (reporter_user_id) REFERENCES users(user_id) ON DELETE SET NULL`);
  await connection.query(`ALTER TABLE \`${databaseName}\`.rescue_teams MODIFY vehicle VARCHAR(120) NULL`);

  for (const [table, column, definition] of [
    ['volunteers', 'responder_type', "ENUM('Volunteer','Barangay Tanod') NOT NULL DEFAULT 'Volunteer'"],
    ['rescue_teams', 'leader_id', 'CHAR(36) NULL']
  ]) {
    const [columns] = await connection.query<mysql.RowDataPacket[]>(
      'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME=?',
      [databaseName, table, column]
    );
    if (!columns.length) await connection.query(`ALTER TABLE \`${databaseName}\`.\`${table}\` ADD COLUMN \`${column}\` ${definition}`);
  }

  const [passwordChangeColumns] = await connection.query<mysql.RowDataPacket[]>(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME='users' AND COLUMN_NAME='must_change_password'",
    [databaseName]
  );
  if (!passwordChangeColumns.length) {
    await connection.query(`ALTER TABLE \`${databaseName}\`.users ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT FALSE AFTER password_hash`);
  }
  const [credentialVersionColumns] = await connection.query<mysql.RowDataPacket[]>(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME='users' AND COLUMN_NAME='credential_version'",
    [databaseName]
  );
  if (!credentialVersionColumns.length) {
    await connection.query(`ALTER TABLE \`${databaseName}\`.users ADD COLUMN credential_version INT NOT NULL DEFAULT 0 AFTER must_change_password`);
  }

  // Compatibility cleanup for databases created before risk zones and
  // evacuation shelters replaced the monitoring-station feature.
  await connection.query(`ALTER TABLE \`${databaseName}\`.zones MODIFY risk_level ENUM('Low','Medium','High') NULL`);
  const [zoneColorColumns] = await connection.query<mysql.RowDataPacket[]>(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME='zones' AND COLUMN_NAME='zone_color'",
    [databaseName]
  );
  if (!zoneColorColumns.length) {
    await connection.query(`ALTER TABLE \`${databaseName}\`.zones ADD COLUMN zone_color CHAR(7) NOT NULL DEFAULT '#1764C1' AFTER zone_name`);
  }
  const [incidentTypeColumns] = await connection.query<mysql.RowDataPacket[]>(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME='flood_reports' AND COLUMN_NAME='incident_type'",
    [databaseName]
  );
  if (!incidentTypeColumns.length) {
    await connection.query(
      `ALTER TABLE \`${databaseName}\`.flood_reports ADD COLUMN incident_type ENUM('River Flooding','Flash Flood','Road Flooding','Drainage Overflow','Rising Water','Other') NOT NULL DEFAULT 'Other' AFTER location_text`
    );
  }
  const [householdStatusColumns] = await connection.query<mysql.RowDataPacket[]>(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME='households' AND COLUMN_NAME='verification_status'",
    [databaseName]
  );
  if (!householdStatusColumns.length) {
    await connection.query(
      `ALTER TABLE \`${databaseName}\`.households ADD COLUMN verification_status ENUM('Pending Verification','Verified','Rejected') NOT NULL DEFAULT 'Pending Verification' AFTER contact_number`
    );
  }
  const residentColumns = [
    ["vulnerability_other", "VARCHAR(160) NULL"], ["relationship_to_head", "VARCHAR(60) NULL"],
    ["relationship_other", "VARCHAR(160) NULL"], ["marital_status", "VARCHAR(30) NULL"],
    ["out_of_school_youth", "VARCHAR(5) NULL"], ["occupation", "VARCHAR(160) NULL"],
    ["education", "VARCHAR(160) NULL"], ["philsys_number", "VARCHAR(80) NULL"],
    ["philhealth_number", "VARCHAR(80) NULL"], ["fp_use", "VARCHAR(5) NULL"],
    ["unmet_needs", "VARCHAR(5) NULL"], ["pwd_specify", "VARCHAR(160) NULL"],
    ["solo_parent", "VARCHAR(5) NULL"], ["morbidity", "VARCHAR(160) NULL"],
    ["water_source_level", "VARCHAR(5) NULL"], ["sanitary_toilet", "VARCHAR(10) NULL"],
    ["can_swim", "VARCHAR(3) NULL"], ["house_type", "VARCHAR(20) NULL"],
    ["record_status", "ENUM('Active','Inactive') NOT NULL DEFAULT 'Active'"],
    ["evacuation_shelter_id", "CHAR(36) NULL"]
  ] as const;
  for (const [column, definition] of residentColumns) {
    const [columns] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME='residents' AND COLUMN_NAME=?",
      [databaseName, column]
    );
    if (!columns.length) await connection.query(`ALTER TABLE \`${databaseName}\`.residents ADD COLUMN \`${column}\` ${definition}`);
  }
  const [residentShelterIndexes] = await connection.query<mysql.RowDataPacket[]>(
    "SELECT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=? AND TABLE_NAME='residents' AND INDEX_NAME='residents_shelter_idx'",
    [databaseName]
  );
  if (!residentShelterIndexes.length) {
    await connection.query(`CREATE INDEX residents_shelter_idx ON \`${databaseName}\`.residents(evacuation_shelter_id)`);
  }
  const [shelterStatusColumns] = await connection.query<mysql.RowDataPacket[]>(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME='shelters' AND COLUMN_NAME='record_status'",
    [databaseName]
  );
  if (!shelterStatusColumns.length) {
    await connection.query(`ALTER TABLE \`${databaseName}\`.shelters ADD COLUMN record_status ENUM('Active','Inactive') NOT NULL DEFAULT 'Active' AFTER status`);
  }
  // Keep upgrades from older installations safe even when this feature's table
  // was not present in the database dump used by the hosting provider.
  await connection.query(`
    CREATE TABLE IF NOT EXISTS \`${databaseName}\`.evacuation_assignments (
      assignment_id CHAR(36) PRIMARY KEY,
      resident_id CHAR(36) NOT NULL,
      shelter_id CHAR(36) NULL,
      action ENUM('Assigned','Transferred','Returned Home') NOT NULL,
      evacuation_at DATETIME NOT NULL,
      recorded_by_user_id CHAR(36) NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX evacuation_assignment_resident_idx (resident_id, created_at),
      INDEX evacuation_assignment_shelter_idx (shelter_id, created_at)
    )
  `);
  console.log(`Database "${databaseName}" schema migration completed.`);
} finally {
  await connection.end();
}
