import { db } from "./db.js";
import type { RowDataPacket } from "mysql2/promise";

// Add only the new resident fields, without reseeding or rebuilding the database.
try {
  for (const [column, definition] of [
    ["can_swim", "VARCHAR(3) NULL"],
    ["house_type", "VARCHAR(20) NULL"]
  ] as const) {
    const [columns] = await db.query<RowDataPacket[]>(
      "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='residents' AND COLUMN_NAME=?",
      [column]
    );
    if (!columns.length) await db.query(`ALTER TABLE residents ADD COLUMN ${column} ${definition}`);
  }
  console.log("Resident swimming ability and house type columns are ready.");
} finally {
  await db.end();
}
