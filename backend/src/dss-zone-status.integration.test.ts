import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db } from './db.js';
import { criticalZoneStatus, zoneStatusInput } from './dss-zone-status.js';

const connection = await db.getConnection();
const zoneId = randomUUID(), otherZoneId = randomUUID();
const householdId = randomUUID(), otherHouseholdId = randomUUID();
const ids = Array.from({ length: 6 }, () => randomUUID());
const reportIds = [randomUUID(), randomUUID()];
try {
  await connection.beginTransaction();
  for (const id of [zoneId, otherZoneId]) await connection.query('INSERT INTO zones(zone_id,zone_name,polygon_geojson) VALUES(?,?,?)', [id, `DSS check ${id}`, JSON.stringify({ type: 'Polygon', coordinates: [] })]);
  for (const [id, zone] of [[householdId, zoneId], [otherHouseholdId, otherZoneId]]) await connection.query('INSERT INTO households(household_id,household_number,zone_id,address_line,head_of_household_name) VALUES(?,?,?,?,?)', [id, `Check ${id}`, zone, 'Test address', 'Test head']);
  const statuses = ['Safe', 'For Monitoring', 'For Evacuation', 'Evacuated', 'Safe', 'Safe'];
  for (let i = 0; i < ids.length; i++) await connection.query(`INSERT INTO residents(resident_id,household_id,full_name,date_of_birth,sex,address_line,evacuation_status,record_status)
    VALUES(?,?,?,'1950-01-01','Female','Test address',?,?)`, [ids[i], i === 5 ? otherHouseholdId : householdId, `Test resident ${i}`, statuses[i], i === 4 ? 'Inactive' : 'Active']);
  for (let i = 0; i < reportIds.length; i++) {
    await connection.query(`INSERT INTO flood_reports(report_id,tracking_code,location_text,latitude,longitude,description,photo_urls,severity_level,status)
      VALUES(?,?, 'Test location',13,122,'Test incident','[]',?,'Validated')`, [reportIds[i], `TEST-${reportIds[i]!.slice(0, 20)}`, i === 0 ? 'Major Incident' : 'Information']);
    await connection.query('INSERT INTO flood_report_zones(report_id,zone_id) VALUES(?,?)', [reportIds[i], zoneId]);
  }
  const preview = await criticalZoneStatus(connection, zoneId);
  assert.equal(preview.risk, 'Critical');
  assert.equal(preview.eligibleCount, 3);
  assert.equal(preview.evacuatedCount, 1);
  assert.equal(preview.inactiveCount, 1);
  assert.deepEqual(preview.statusCounts, { Safe: 1, 'For Monitoring': 1, 'For Evacuation': 1 });
  assert.deepEqual(preview.residents.map(r => r.name), ['Test resident 0', 'Test resident 1', 'Test resident 2', 'Test resident 3', 'Test resident 4']);
  assert.equal(preview.residents[0]!.household, `Check ${householdId}`);
  assert.equal(preview.residents[3]!.status, 'Evacuated');
  assert.equal(preview.residents[4]!.recordStatus, 'Inactive');
  assert.deepEqual(Object.keys(preview.residents[0]!).sort(), ['household', 'id', 'name', 'outcome', 'recordStatus', 'status'], 'Preview exposes only fields needed for resident review');
  for(const [i,outcome] of ['Missing','Deceased'].entries())await connection.query('INSERT INTO resident_outcomes(resident_id,outcome,revision,source,notes,last_seen_location,observed_at) VALUES(?,?,1,?,?,?,NOW())',[ids[i],outcome,'Test source','Test details','Test location']);
  const withOutcomes=await criticalZoneStatus(connection,zoneId);
  assert.equal(withOutcomes.eligibleCount,1,'Missing/deceased residents must be excluded from bulk marking');
  await assert.rejects(criticalZoneStatus(connection,zoneId,{status:'For Evacuation',revision:withOutcomes.revision,residentIds:[ids[0]!]}),/Select active/);
  await connection.query('DELETE FROM resident_outcomes WHERE resident_id IN (?)',[ids.slice(0,2)]);
  const snapshot = async () => (await connection.query<any[]>('SELECT resident_id,evacuation_status FROM residents WHERE resident_id IN (?) ORDER BY resident_id', [ids]))[0];
  for (const status of ['For Evacuation', 'For Monitoring', 'Safe'] as const) {
    const current = await criticalZoneStatus(connection, zoneId);
    assert.equal(current.residents.filter(r => r.recordStatus === 'Active' && r.status !== 'Evacuated' && r.status !== status).length, current.eligibleCount - current.statusCounts[status]!);
    const result = await criticalZoneStatus(connection, zoneId, { status, revision: current.revision, residentIds: ids.slice(0, 3) });
    assert.equal('updatedCount' in result && result.updatedCount, status === 'For Evacuation' ? 2 : 3);
    const rows = await snapshot();
    const byId = new Map(rows.map(r => [r.resident_id, r.evacuation_status]));
    for (const id of ids.slice(0, 3)) assert.equal(byId.get(id), status);
    assert.equal(byId.get(ids[3]), 'Evacuated');
    assert.equal(byId.get(ids[4]), 'Safe');
    assert.equal(byId.get(ids[5]), 'Safe', 'Other zones must remain unchanged');
  }
  let selectionPreview = await criticalZoneStatus(connection, zoneId);
  const single = await criticalZoneStatus(connection, zoneId, { status: 'For Monitoring', revision: selectionPreview.revision, residentIds: [ids[0]!] });
  assert.equal('updatedCount' in single && single.updatedCount, 1);
  let rows = new Map((await snapshot()).map(r => [r.resident_id, r.evacuation_status]));
  assert.equal(rows.get(ids[0]), 'For Monitoring');
  assert.equal(rows.get(ids[1]), 'Safe');
  assert.equal(rows.get(ids[2]), 'Safe');
  selectionPreview = await criticalZoneStatus(connection, zoneId);
  const multiple = await criticalZoneStatus(connection, zoneId, { status: 'For Evacuation', revision: selectionPreview.revision, residentIds: [ids[1]!, ids[2]!] });
  assert.equal('updatedCount' in multiple && multiple.updatedCount, 2);
  rows = new Map((await snapshot()).map(r => [r.resident_id, r.evacuation_status]));
  assert.equal(rows.get(ids[0]), 'For Monitoring', 'Unselected residents retain their status');
  selectionPreview = await criticalZoneStatus(connection, zoneId);
  const beforeInvalidSelection = await snapshot();
  for (const invalidId of [ids[3]!, ids[4]!, ids[5]!, randomUUID()]) {
    await assert.rejects(criticalZoneStatus(connection, zoneId, { status: 'Safe', revision: selectionPreview.revision, residentIds: [ids[0]!, invalidId] }), /Select active/);
    assert.deepEqual(await snapshot(), beforeInvalidSelection, 'Invalid selections must not partially update valid residents');
  }
  await criticalZoneStatus(connection, zoneId, { status: 'Safe', revision: selectionPreview.revision, residentIds: ids.slice(0, 3) });
  const current = await criticalZoneStatus(connection, zoneId);
  const noChange = await criticalZoneStatus(connection, zoneId, { status: 'Safe', revision: current.revision, residentIds: ids.slice(0, 3) });
  assert.equal('updatedCount' in noChange && noChange.updatedCount, 0);
  await connection.query("UPDATE residents SET evacuation_status='For Monitoring' WHERE resident_id=?", [ids[0]]);
  const before = await snapshot();
  await assert.rejects(criticalZoneStatus(connection, zoneId, { status: 'For Evacuation', revision: current.revision, residentIds: ids.slice(0, 3) }), /records changed/);
  assert.deepEqual(await snapshot(), before, 'Stale preview must not write');
  await connection.query("UPDATE residents SET date_of_birth='1990-01-01' WHERE household_id=? AND record_status='Active'", [householdId]);
  const highPreview = await criticalZoneStatus(connection, zoneId);
  assert.equal(highPreview.risk, 'High', 'Inactive vulnerable residents cannot escalate the action eligibility');
  assert.equal(highPreview.residents.length, 5, 'Residents can be viewed in a non-Critical zone');
  await assert.rejects(criticalZoneStatus(connection, zoneId, { status: 'For Evacuation', revision: highPreview.revision, residentIds: [ids[0]!] }), /no longer Critical/);
  await connection.query("UPDATE residents SET date_of_birth='1950-01-01' WHERE household_id=? AND record_status='Active'", [householdId]);
  await connection.query("UPDATE flood_reports SET status='Resolved' WHERE report_id=?", [reportIds[1]]);
  const downgraded = await criticalZoneStatus(connection, zoneId);
  await assert.rejects(criticalZoneStatus(connection, zoneId, { status: 'For Evacuation', revision: downgraded.revision, residentIds: [ids[0]!] }), /no longer Critical/);
  const lowPreview = await criticalZoneStatus(connection, otherZoneId);
  assert.equal(lowPreview.risk, 'Low');
  assert.deepEqual(lowPreview.residents.map(r => r.id), [ids[5]]);
  const beforeView = await snapshot();
  await criticalZoneStatus(connection, zoneId);
  await criticalZoneStatus(connection, otherZoneId);
  assert.deepEqual(await snapshot(), beforeView, 'Viewing resident lists must not change statuses');
  await connection.query('DELETE FROM residents WHERE resident_id=?', [ids[5]]);
  assert.deepEqual((await criticalZoneStatus(connection, otherZoneId)).residents, [], 'Empty zones can be viewed');
  await assert.rejects(criticalZoneStatus(connection, randomUUID()), /not found/);
  for (const status of ['Evacuated', 'invalid', '', null]) assert.equal(zoneStatusInput.safeParse({ status, revision: current.revision, residentIds: [ids[0]] }).success, false);
  assert.equal(zoneStatusInput.safeParse({ status: 'Safe', revision: 'invalid', residentIds: [ids[0]] }).success, false);
  for (const residentIds of [undefined, [], ['invalid']]) assert.equal(zoneStatusInput.safeParse({ status: 'Safe', revision: current.revision, residentIds }).success, false);
  assert.deepEqual(zoneStatusInput.parse({ status: 'Safe', revision: current.revision, residentIds: [ids[0], ids[0]] }).residentIds, [ids[0]]);
  console.log('PASS: individual, multiple and all-resident marking; invalid selection atomicity; stale-preview rejection; inactive/evacuated/other-zone preservation; input validation. All fixtures rolled back.');
} finally {
  await connection.rollback();
  connection.release();
  await db.end();
}
