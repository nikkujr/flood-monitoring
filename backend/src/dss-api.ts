import { z } from 'zod';
import { db } from './db.js';
import { buildDss, riskLevels, type DssSource } from './dss.js';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>!Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0,10)===v,'Invalid date');
export const dssQuery = z.object({
  zone:z.string().uuid().optional(),risk:z.enum(riskLevels).optional(),from:date.optional(),to:date.optional(),
  severity:z.enum(['Information','Minor Incident','Major Incident']).optional(),
  evacuationStatus:z.enum(['Safe','For Monitoring','For Evacuation','Evacuated']).optional(),
  vulnerability:z.enum(['Any','Senior citizen','PWD','Pregnant','Child','Morbidity','Other']).optional()
}).refine(v=>!v.from || !v.to || v.from<=v.to,{message:'Start date must not be after end date',path:['from']});

export async function loadDss(query: unknown) {
  const filters = dssQuery.parse(query);
  const connection = await db.getConnection();
  try {
    await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await connection.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
    const [zones] = await connection.query<any[]>('SELECT zone_id,zone_name FROM zones ORDER BY zone_name');
    const [households] = await connection.query<any[]>('SELECT household_id,household_number,zone_id,address_line,head_of_household_name FROM households');
    const [residents] = await connection.query<any[]>(`SELECT resident_id,household_id,full_name,CAST(date_of_birth AS CHAR) date_of_birth,address_line,vulnerability_type,vulnerability_other,pwd_specify,morbidity,can_swim,house_type,priority_level,evacuation_status FROM residents`);
    const [reports] = await connection.query<any[]>(`SELECT report_id,tracking_code,location_text,severity_level,status,DATE_FORMAT(created_at,'%Y-%m-%d %H:%i:%s') created_at,incident_type FROM flood_reports`);
    const [reportZones] = await connection.query<any[]>('SELECT report_id,zone_id FROM flood_report_zones');
    const [shelters] = await connection.query<any[]>('SELECT shelter_id,shelter_name,zone_id,location_text,capacity,current_occupancy,status FROM shelters');
    await connection.commit();
    return buildDss({zones,households,residents,reports,reportZones,shelters} as DssSource,filters);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally { connection.release(); }
}
