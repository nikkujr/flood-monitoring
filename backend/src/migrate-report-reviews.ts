import { readFile } from 'node:fs/promises';
import { db } from './db.js';
try {
  await db.query(await readFile(new URL('../sql/20261007_report_reviews.sql',import.meta.url),'utf8'));
  console.log('Flood-report review history is ready.');
} finally { await db.end(); }
