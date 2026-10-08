import {readFile} from 'node:fs/promises';
import {db} from './db.js';
try {
  const [columns]=await db.query<any[]>("SHOW COLUMNS FROM volunteers LIKE 'responder_type'");
  if(!columns.length)await db.query("ALTER TABLE volunteers ADD COLUMN responder_type ENUM('Volunteer','Barangay Tanod') NOT NULL DEFAULT 'Volunteer'");
  const [leaders]=await db.query<any[]>("SHOW COLUMNS FROM rescue_teams LIKE 'leader_id'");
  if(!leaders.length)await db.query('ALTER TABLE rescue_teams ADD COLUMN leader_id CHAR(36) NULL');
  await db.query('ALTER TABLE rescue_teams MODIFY vehicle VARCHAR(120) NULL');
  const sql=await readFile(new URL('../sql/20261008_responders_outcomes.sql',import.meta.url),'utf8');
  for(const statement of sql.split(';').filter(s=>s.trim()))await db.query(statement);
  console.log('Responder membership and resident outcome tables ready. Existing records were preserved.');
}finally{await db.end();}
