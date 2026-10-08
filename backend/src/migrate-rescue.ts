import {readFile} from 'node:fs/promises';
import {db} from './db.js';
try {
  const sql=await readFile(new URL('../sql/20261008_rescue_missions.sql',import.meta.url),'utf8');
  for(const statement of sql.split(';').filter(s=>s.trim())) await db.query(statement);
  await db.query('ALTER TABLE rescue_teams MODIFY vehicle VARCHAR(120) NULL');
  console.log('Rescue mission tables are ready. Existing records were not changed.');
} finally {await db.end();}
