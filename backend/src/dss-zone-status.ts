import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { PoolConnection } from 'mysql2/promise';
import { assessRisk, vulnerabilities, type Resident, type Report } from './dss.js';

export const zoneStatusInput = z.object({
  status: z.enum(['Safe', 'For Monitoring', 'For Evacuation']),
  revision: z.string().regex(/^[a-f0-9]{64}$/),
  residentIds: z.array(z.string().uuid()).min(1).transform(ids => [...new Set(ids)])
});

export async function criticalZoneStatus(connection: PoolConnection, zoneId: string, input?: z.infer<typeof zoneStatusInput>) {
  const [zones] = await connection.query<any[]>('SELECT zone_id,zone_name FROM zones WHERE zone_id=? FOR UPDATE', [zoneId]);
  if (!zones[0]) throw Object.assign(new Error('Barangay zone not found.'), { status: 404 });
  const [residents] = await connection.query<any[]>(`SELECT r.*,CAST(r.date_of_birth AS CHAR) date_of_birth,h.household_number
    FROM residents r JOIN households h ON h.household_id=r.household_id WHERE h.zone_id=? ORDER BY r.resident_id FOR UPDATE`, [zoneId]);
  const [reports] = await connection.query<any[]>(`SELECT fr.report_id,fr.status,fr.severity_level,fr.updated_at
    FROM flood_reports fr JOIN flood_report_zones frz ON frz.report_id=fr.report_id
    WHERE frz.zone_id=? AND fr.status='Validated' ORDER BY fr.report_id FOR UPDATE`, [zoneId]);
  const active = residents.filter(r => r.record_status === 'Active');
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const risk = assessRisk(reports as Report[], active.filter(r => vulnerabilities(r as Resident, today).length).length).risk;
  const eligible = active.filter(r => r.evacuation_status !== 'Evacuated');
  const revision = createHash('sha256').update(JSON.stringify({ today, residents, reports })).digest('hex');
  const preview = {
    zone: zones[0].zone_name, risk, revision, eligibleCount: eligible.length,
    evacuatedCount: active.length - eligible.length, inactiveCount: residents.length - active.length,
    statusCounts: Object.fromEntries(['Safe', 'For Monitoring', 'For Evacuation'].map(status => [status, eligible.filter(r => r.evacuation_status === status).length])),
    residents: residents.map(r => ({ id: String(r.resident_id), name: String(r.full_name), household: String(r.household_number), status: String(r.evacuation_status), recordStatus: String(r.record_status) }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
  };
  if (!input) return preview;
  if (risk !== 'Critical') throw Object.assign(new Error('This zone is no longer Critical. Refresh the DSS assessment.'), { status: 409 });
  if (input.revision !== revision) throw Object.assign(new Error('Zone evidence or resident records changed. Reopen the action to review the current count.'), { status: 409 });
  const selected = new Set(input.residentIds);
  const eligibleIds = new Set(eligible.map(r => r.resident_id));
  if (!selected.size || [...selected].some(id => !eligibleIds.has(id))) {
    throw Object.assign(new Error('Select active, non-evacuated residents belonging to this zone.'), { status: 400 });
  }
  const ids = eligible.filter(r => selected.has(r.resident_id) && r.evacuation_status !== input.status).map(r => r.resident_id);
  if (ids.length) await connection.query('UPDATE residents SET evacuation_status=? WHERE resident_id IN (?)', [input.status, ids]);
  return { ...preview, updatedCount: ids.length, message: `${ids.length} residents marked ${input.status}.` };
}
