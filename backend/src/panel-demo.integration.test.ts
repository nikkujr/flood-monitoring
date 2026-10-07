import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db } from './db.js';
import { config } from './config.js';
import { createAccessToken } from './auth.js';

// Run against the local API. Only isolated rehearsal records are changed and removed.
const zone = randomUUID(), household = randomUUID(), shelter = randomUUID();
const residents = [randomUUID(), randomUUID()];
const reports: string[] = [];
const name = `Panel rehearsal ${zone}`;
try {
  const [users] = await db.query<any[]>("SELECT user_id,username,role,credential_version FROM users WHERE is_active=1 AND must_change_password=0 AND role='Super Admin' LIMIT 1");
  assert.ok(users[0], 'An active administrator is required');
  const user = users[0];
  const headers = { authorization: `Bearer ${createAccessToken({ userId:user.user_id, username:user.username, role:user.role, credentialVersion:user.credential_version })}`, 'content-type':'application/json' };
  const request = async (path:string, method='GET', body?:unknown, expected=200, authenticated=true) => {
    const response = await fetch(`http://localhost:${config.port}/api/${path}`, {method, headers:authenticated?headers:{'content-type':'application/json'}, body:body===undefined?undefined:JSON.stringify(body)});
    const text = await response.text();
    assert.equal(response.status, expected, `${method} ${path}: ${text}`);
    return text ? JSON.parse(text) : undefined;
  };
  await db.execute('INSERT INTO zones(zone_id,zone_name,polygon_geojson) VALUES(?,?,?)', [zone,name,JSON.stringify({type:'Polygon',coordinates:[[[.9,.9],[1.1,.9],[1.1,1.1],[.9,1.1],[.9,.9]]]})]);
  await db.execute('INSERT INTO households(household_id,household_number,zone_id,address_line,head_of_household_name) VALUES(?,?,?,?,?)',[household,name,zone,'Rehearsal only','Fictional household']);
  for (const [index,id] of residents.entries()) await db.execute("INSERT INTO residents(resident_id,household_id,full_name,date_of_birth,sex,address_line,evacuation_status) VALUES(?,?,?,'1950-01-01','Female','Rehearsal only','Safe')",[id,household,`Fictional rehearsal resident ${index+1}`]);
  await db.execute('INSERT INTO shelters(shelter_id,shelter_name,zone_id,location_text,latitude,longitude,capacity,contact_person,contact_number) VALUES(?,?,?,?,1,1,1,?,?)',[shelter,name,zone,'Rehearsal only','Fictional contact','09123456789']);
  const assessment = () => request(`statistics/dss?zone=${zone}`);
  assert.equal((await assessment()).overall.risk,'Low');
  for (let i=0;i<2;i++) {
    const submitted = await request('flood-reports','POST',{reporterName:'Fictional reporter',reporterContactInfo:'09123456789',locationText:'Rehearsal only',latitude:1,longitude:1,incidentType:'River Flooding',severityLevel:i===0?'Major Incident':'Information',description:'Temporary panel workflow check'},201,false);
    reports.push(submitted.reportId);
    assert.equal(submitted.zoneId,zone);
    assert.equal(submitted.status,'Submitted');
    const publicFeed = await request(`flood-reports/public?search=${submitted.trackingCode}`,'GET',undefined,200,false);
    assert.equal(publicFeed.items.length,0,'Unverified reports must not be public');
    await request(`flood-reports/${submitted.reportId}/status`,'PUT',{expectedStatus:'Submitted',status:'Under Review',severityLevel:i===0?'Major Incident':'Information',validationNotes:'Rehearsal verification',zoneIds:[zone]},204);
    await request(`flood-reports/${submitted.reportId}/status`,'PUT',{expectedStatus:'Under Review',status:'Validated',severityLevel:i===0?'Major Incident':'Information',validationNotes:'Confirmed fictional rehearsal',zoneIds:[zone]},204);
    const published = await request(`flood-reports/public?search=${submitted.trackingCode}`,'GET',undefined,200,false);
    assert.equal(published.items.length,1);
    assert.ok(!('reporter_name' in published.items[0]) && !('reporter_contact_info' in published.items[0]));
    assert.equal((await assessment()).overall.risk,i===0?'High':'Critical');
  }
  const dss = await assessment();
  assert.equal(dss.zones[0].activeReports,2);
  assert.equal(dss.zones[0].vulnerableResidents,2);
  assert.ok(dss.recommendations.some((r:any)=>r.text.includes('additional shelter space')));
  const allDss = await request('statistics/dss');
  const [occupancy] = await db.query<any[]>("SELECT s.shelter_id,s.record_status,COUNT(r.resident_id) occupancy FROM shelters s LEFT JOIN residents r ON r.evacuation_shelter_id=s.shelter_id AND r.evacuation_status='Evacuated' AND r.record_status='Active' GROUP BY s.shelter_id,s.record_status");
  assert.equal(allDss.shelters.length,occupancy.filter(s=>s.record_status==='Active').length);
  for (const center of allDss.shelters) assert.equal(center.occupancy,Number(occupancy.find(s=>s.shelter_id===center.id).occupancy),'DSS occupancy must match active assigned residents');
  const summary = await request('statistics/risk-summary');
  assert.equal(summary.overallRiskLevel,allDss.overall.risk);
  assert.equal(summary.activeValidatedReports,allDss.metrics.activeReports);
  assert.equal(summary.affectedZones,allDss.metrics.affectedZones);
  assert.equal(summary.priorityResidents,allDss.metrics.priorityResidents);
  const beforeSimulation = await request(`statistics/dss?zone=${zone}`);
  const simulated = await request('statistics/dss/simulation','POST',{zoneId:zone,additionalMajorReports:1,unavailableShelterIds:[shelter]});
  assert.equal(simulated.baseline.shelters.find((s:any)=>s.id===shelter).available,1);
  assert.equal(simulated.simulated.shelters.find((s:any)=>s.id===shelter).available,0);
  assert.equal(simulated.simulated.zones.find((z:any)=>z.id===zone).activeReports,3);
  const afterSimulation = await request(`statistics/dss?zone=${zone}`);
  assert.deepEqual(afterSimulation.zones,beforeSimulation.zones,'Simulation must not create live incidents');
  assert.deepEqual(afterSimulation.shelters,beforeSimulation.shelters,'Simulation must not close live centers');
  await request('statistics/dss/simulation','POST',{additionalMajorReports:1},400);
  await request('statistics/dss/simulation','POST',{},401,false);
  const previewPath = `statistics/dss/zones/${zone}/resident-status`;
  let preview = await request(previewPath);
  await request(previewPath,'POST',{status:'For Monitoring',revision:preview.revision,residentIds:[residents[0]]});
  preview = await request(previewPath);
  assert.equal(preview.residents.find((r:any)=>r.id===residents[0]).status,'For Monitoring');
  assert.equal(preview.residents.find((r:any)=>r.id===residents[1]).status,'Safe');
  await request(previewPath,'POST',{status:'For Evacuation',revision:preview.revision,residentIds:residents});
  const assignment = (ids:string[]) => ({residentIds:ids,evacuationAt:new Date().toISOString(),evacuationStatus:'Evacuated'});
  await request(`shelters/${shelter}/assignments`,'POST',assignment(residents),409);
  assert.ok((await request(previewPath)).residents.every((r:any)=>r.status==='For Evacuation'),'Capacity rejection must be atomic');
  await request(`shelters/${shelter}/assignments`,'POST',{...assignment([residents[0]!]),expectedStatuses:{[residents[0]!]: 'Safe'}},409);
  assert.ok((await request(previewPath)).residents.every((r:any)=>r.status==='For Evacuation'),'Stale plan rejection must not update residents');
  await request(`shelters/${shelter}/assignments`,'POST',{...assignment([residents[0]!]),expectedStatuses:{[residents[0]!]: 'For Evacuation'}});
  const profile = await request(`residents/${residents[0]}/details`);
  assert.equal(profile.resident.evacuation_status,'Evacuated');
  assert.equal(profile.history[0].action,'Assigned');
  assert.equal((await assessment()).shelters[0].available,0);
  await request(`residents/${residents[0]}/return-home`,'POST',{returnedAt:new Date().toISOString()});
  assert.equal((await request(`residents/${residents[0]}/details`)).resident.evacuation_status,'Safe');
  assert.equal((await assessment()).shelters[0].available,1);
  console.log('PASS: public submission → verification → High/Critical assessment → recommendations → individual/bulk marking → capacity protection → shelter assignment/history → return home; dashboard and DSS agree.');
} finally {
  if (reports.length) {
    await db.query('DELETE FROM flood_report_zones WHERE report_id IN (?)',[reports]);
    await db.query('DELETE FROM flood_reports WHERE report_id IN (?)',[reports]);
  }
  await db.query('DELETE FROM evacuation_assignments WHERE resident_id IN (?)',[residents]);
  await db.query('DELETE FROM resident_year_snapshots WHERE resident_id IN (?)',[residents]);
  await db.query('DELETE FROM residents WHERE resident_id IN (?)',[residents]);
  await db.execute('DELETE FROM household_year_snapshots WHERE household_id=?',[household]);
  await db.execute('DELETE FROM households WHERE household_id=?',[household]);
  await db.execute('DELETE FROM shelters WHERE shelter_id=?',[shelter]);
  await db.execute('DELETE FROM risk_zones WHERE risk_zone_name=?',[`Automatic Flood Risk - ${name}`]);
  await db.execute('DELETE FROM zones WHERE zone_id=?',[zone]);
  await db.end();
  console.log('Temporary rehearsal records removed.');
}
