import { readFile } from "node:fs/promises";
import mysql from "mysql2/promise";
import { config } from "./config.js";

type Mode = "init" | "fresh";

const mode = process.argv[2] as Mode | undefined;
if (mode !== "init" && mode !== "fresh") {
  throw new Error("Usage: tsx src/database.ts <init|fresh>");
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
  if (mode === "fresh") {
    await connection.query(`DROP DATABASE IF EXISTS \`${databaseName}\``);
  }

  const schemaTemplate = await readFile(new URL("../sql/schema.sql", import.meta.url), "utf8");
  const schema = schemaTemplate
    .replace("CREATE DATABASE IF NOT EXISTS bantay_baha", `CREATE DATABASE IF NOT EXISTS \`${databaseName}\``)
    .replace("USE bantay_baha;", `USE \`${databaseName}\`;`);
  await connection.query(schema);

  // Compatibility cleanup for databases created before risk zones and
  // evacuation shelters replaced the monitoring-station feature.
  await connection.query(`ALTER TABLE \`${databaseName}\`.zones MODIFY risk_level ENUM('Low','Medium','High') NULL`);
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
  await connection.query(`DROP TABLE IF EXISTS \`${databaseName}\`.monitoring_stations`);

  console.log(mode === "fresh"
    ? `Database "${databaseName}" was rebuilt from the current schema.`
    : `Database "${databaseName}" is initialized and up to date.`);
} finally {
  await connection.end();
}
