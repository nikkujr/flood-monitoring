import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db } from './db.js';
import { config } from './config.js';
import { createAccessToken } from './auth.js';

// Run against the local API and its configured database; only this fixture is removed.
const id = randomUUID();
let inserted = false;
try {
  const [users] = await db.query<any[]>("SELECT user_id,username,role,credential_version,full_name FROM users WHERE is_active=1 AND must_change_password=0 AND role='Super Admin' LIMIT 1");
  const [zones] = await db.query<any[]>('SELECT zone_id,zone_name FROM zones LIMIT 1');
  assert.ok(users[0] && zones[0], 'An active admin and a zone are required');
  const user = users[0];
  const token = createAccessToken({ userId:user.user_id, username:user.username, role:user.role, credentialVersion:user.credential_version });
  const url = `http://localhost:${config.port}/api/flood-reports/${id}`;
  const headers = { authorization:`Bearer ${token}`, 'content-type':'application/json' };
  await db.execute("INSERT INTO flood_reports(report_id,tracking_code,location_text,latitude,longitude,description,photo_urls) VALUES(?,?,?,0,0,?,'[]')", [id,`TEST-${id.slice(0,20)}`,'Automated review verification','Temporary integration test; automatically removed']);
  inserted = true;
  const read = async () => {
    const response = await fetch(url, {headers});
    assert.equal(response.status, 200);
    return response.json() as Promise<any>;
  };
  const review = async (expectedStatus:string, status:string, validationNotes:string, zoneIds:string[] = []) => fetch(`${url}/status`, {method:'PUT',headers,body:JSON.stringify({expectedStatus,status,validationNotes,zoneIds,severityLevel:'Information'})});
  assert.equal((await read()).reviews.length, 0);
  assert.equal((await review('Submitted','Under Review','Checking the report')).status, 204);
  assert.equal((await review('Submitted','Rejected','Stale decision')).status, 409);
  let report = await read();
  assert.equal(report.status, 'Under Review');
  assert.equal(report.reviews.length, 1);
  assert.equal((await review('Under Review','Validated','Confirmed', [zones[0].zone_id])).status, 204);
  report = await read();
  const validatedAt = report.validated_at;
  assert.ok(validatedAt);
  assert.equal((await review('Validated','Validated','Additional context', [zones[0].zone_id])).status, 204);
  assert.equal((await read()).validated_at, validatedAt);
  assert.equal((await review('Validated','Resolved','', [zones[0].zone_id])).status, 400);
  assert.equal((await read()).reviews.length, 3);
  assert.equal((await review('Validated','Resolved','Water has receded', [zones[0].zone_id])).status, 204);
  report = await read();
  assert.equal(report.status, 'Resolved');
  assert.deepEqual(report.reviews.map((r:any) => r.notes), ['Checking the report','Confirmed','Additional context','Water has receded']);
  assert.ok(report.reviews.every((r:any) => r.reviewer_name === user.full_name && r.created_at));
  assert.deepEqual(report.reviews[1].affected_zones, [zones[0].zone_name]);
  assert.equal((await review('Resolved','Under Review','Reopened for follow-up')).status, 204);
  assert.equal((await read()).reviews.length, 5);
  console.log('PASS: review history, zone/reviewer snapshots, validation timestamp, invalid resolution, stale-status rejection, and reopening.');
} finally {
  if (inserted) {
    await db.execute('DELETE FROM flood_report_zones WHERE report_id=?', [id]);
    await db.execute('DELETE FROM flood_reports WHERE report_id=?', [id]);
    const [reviews] = await db.query<any[]>('SELECT review_id FROM flood_report_reviews WHERE report_id=?', [id]);
    assert.equal(reviews.length, 0, 'Fixture history should be removed by the foreign key');
  }
  await db.end();
}
