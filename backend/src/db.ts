import mysql from "mysql2/promise";
import { config } from "./config.js";

export const db = mysql.createPool({
  uri: config.databaseUrl,
  connectionLimit: 10,
  namedPlaceholders: true,
  decimalNumbers: true
});

export async function healthcheck() {
  await db.query("SELECT 1");
}
