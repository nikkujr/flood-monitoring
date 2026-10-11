import { z } from 'zod';
import { db } from './db.js';
import { assessRisk, buildDss, riskLevels, vulnerabilities, type DssSource, type Report, type Resident } from './dss.js';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>!Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0,10)===v,'Invalid date');
export const dssQuery = z.object({
  zone:z.string().uuid().optional(),risk:z.enum(riskLevels).optional(),from:date.optional(),to:date.optional(),
  severity:z.enum(['Information','Minor Incident','Major Incident']).optional(),
  evacuationStatus:z.enum(['Safe','For Monitoring','For Evacuation','Evacuated']).optional(),
  vulnerability:z.enum(['Any','Senior citizen','PWD','Pregnant','Child','Morbidity','Other']).optional()
}).refine(v=>!v.from || !v.to || v.from<=v.to,{message:'Start date must not be after end date',path:['from']});

export async function loadDss(query: unknown) {
  const filters = dssQuery.parse(query);
  await syncZoneEvacuationStatuses();
  return buildDss(await loadDssSource(), filters);
}

const evacuationStatusForRisk = {
  Low: 'Safe',
  Moderate: 'For Monitoring',
  High: 'For Evacuation',
  Critical: 'For Evacuation'
} as const;

/**
 * Keep operational resident statuses aligned with the live DSS assessment.
 * Confirmed evacuation and outcome records are deliberately left untouched.
 */
export async function syncZoneEvacuationStatuses() {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [zones] = await connection.query<any[]>('SELECT zone_id FROM zones ORDER BY zone_id FOR UPDATE');
    const [households] = await connection.query<any[]>('SELECT household_id,zone_id FROM households');
    const [residents] = await connection.query<any[]>(`SELECT r.resident_id,r.household_id,r.full_name,CAST(r.date_of_birth AS CHAR) date_of_birth,r.address_line,
      r.vulnerability_type,r.vulnerability_other,r.pwd_specify,r.morbidity,r.can_swim,r.house_type,r.priority_level,r.evacuation_status,r.record_status,
      (SELECT outcome FROM resident_outcomes o WHERE o.resident_id=r.resident_id) outcome
      FROM residents r FOR UPDATE`);
    const [reports] = await connection.query<any[]>(`SELECT fr.report_id,fr.status,fr.severity_level,fr.updated_at,frz.zone_id
      FROM flood_reports fr JOIN flood_report_zones frz ON frz.report_id=fr.report_id
      WHERE fr.status='Validated' FOR UPDATE`);
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const zoneByHousehold = new Map(households.map(row => [row.household_id, row.zone_id]));

    for (const zone of zones) {
      const zoneResidents = residents.filter(row => zoneByHousehold.get(row.household_id) === zone.zone_id);
      const active = zoneResidents.filter(row => row.record_status === 'Active' && !['Missing', 'Deceased'].includes(row.outcome));
      const vulnerableCount = active.filter(row => vulnerabilities(row as Resident, today).length > 0).length;
      const risk = assessRisk(reports.filter(row => row.zone_id === zone.zone_id) as Report[], vulnerableCount).risk;
      const target = evacuationStatusForRisk[risk];
      const ids = active
        .filter(row => row.evacuation_status !== 'Evacuated' && row.evacuation_status !== target)
        .map(row => row.resident_id);
      if (ids.length) await connection.query('UPDATE residents SET evacuation_status=? WHERE resident_id IN (?)', [target, ids]);
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function loadDssSource(): Promise<DssSource> {
  const connection = await db.getConnection();
  try {
    await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await connection.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
    const [zones] = await connection.query<any[]>('SELECT zone_id,zone_name FROM zones ORDER BY zone_name');
    const [households] = await connection.query<any[]>('SELECT household_id,household_number,zone_id,address_line,head_of_household_name FROM households');
    const [residents] = await connection.query<any[]>(`SELECT resident_id,household_id,full_name,CAST(date_of_birth AS CHAR) date_of_birth,address_line,vulnerability_type,vulnerability_other,pwd_specify,morbidity,can_swim,house_type,priority_level,evacuation_status,(SELECT outcome FROM resident_outcomes o WHERE o.resident_id=residents.resident_id) outcome FROM residents WHERE record_status='Active'`);
    const [reports] = await connection.query<any[]>(`SELECT report_id,tracking_code,location_text,severity_level,status,DATE_FORMAT(created_at,'%Y-%m-%d %H:%i:%s') created_at,incident_type FROM flood_reports`);
    const [reportZones] = await connection.query<any[]>('SELECT report_id,zone_id FROM flood_report_zones');
    const [shelters] = await connection.query<any[]>(`SELECT s.shelter_id,s.shelter_name,s.zone_id,s.location_text,s.capacity,s.status,
      (SELECT COUNT(*) FROM residents r WHERE r.evacuation_shelter_id=s.shelter_id AND r.evacuation_status='Evacuated' AND r.record_status='Active') current_occupancy
      FROM shelters s WHERE s.record_status='Active'`);
    await connection.commit();
    return {zones,households,residents,reports,reportZones,shelters} as DssSource;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally { connection.release(); }
}
