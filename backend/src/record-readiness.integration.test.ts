import assert from 'node:assert/strict';
import {db} from './db.js';
import {config} from './config.js';
import {createAccessToken} from './auth.js';
import {residentQualityConditions,reportMissingZone} from './record-readiness.js';
try {
  const [users]=await db.query<any[]>("SELECT user_id,username,role,credential_version FROM users WHERE is_active=1 AND must_change_password=0 AND role='Super Admin' LIMIT 1");
  assert.ok(users[0]);const user=users[0];
  const headers={authorization:`Bearer ${createAccessToken({userId:user.user_id,username:user.username,role:user.role,credentialVersion:user.credential_version})}`};
  const get=async(path:string)=>{const r=await fetch(`http://localhost:${config.port}/api/${path}`,{headers});assert.equal(r.status,200,path);return r.json() as Promise<any>;};
  const quality=await get('records/quality');
  for(const [key,condition] of Object.entries(residentQualityConditions)) {
    const [rows]=await db.query<any[]>(`SELECT COUNT(*) count FROM residents r WHERE ${condition}`);
    assert.equal(Number(quality[key]),Number(rows[0].count),key);
    const list=await get(`residents/yearly?filter_${key}=true`);assert.equal(list.totalItems,Number(quality[key]),`${key} drilldown`);
  }
  const [reports]=await db.query<any[]>(`SELECT COUNT(*) count FROM flood_reports WHERE ${reportMissingZone}`);
  assert.equal(Number(quality.missingZone),Number(reports[0].count));
  assert.equal((await get('flood-reports?filter_missingZone=true')).totalItems,Number(quality.missingZone));
  assert.equal((await get('flood-reports?filter_pending=true')).totalItems,Number(quality.pending));
  const [residents]=await db.query<any[]>('SELECT resident_id,household_id FROM residents LIMIT 1');
  if(residents[0]) {
    const profile=await get(`residents/${residents[0].resident_id}/details`);
    assert.equal(profile.resident.resident_id,residents[0].resident_id);assert.ok(Array.isArray(profile.history));assert.ok(Array.isArray(profile.flags));
    assert.equal((await get(`residents/${residents[0].resident_id}`)).date_of_birth,profile.resident.date_of_birth,'Edit/profile dates must match without timezone conversion');
    const snapshot=await get(`residents/yearly?filter_household=${residents[0].household_id}&pageSize=100`);
    assert.equal(snapshot.items.find((r:any)=>r.resident_id===residents[0].resident_id)?.date_of_birth,profile.resident.date_of_birth,'Snapshot date must stay a calendar date');
    const household=await get(`households/${residents[0].household_id}/details`);
    const member=household.members.find((m:any)=>m.id===residents[0].resident_id);assert.ok(member);assert.deepEqual(member.flags,profile.flags);
  }
  assert.equal((await fetch(`http://localhost:${config.port}/api/records/quality`)).status,401);
  console.log('PASS: authenticated profiles, household readiness, quality totals and all five filtered drilldowns; unauthenticated access denied.');
}finally{await db.end();}
