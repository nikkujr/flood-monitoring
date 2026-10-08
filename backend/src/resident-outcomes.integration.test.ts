import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {db} from './db.js';
import {config} from './config.js';
import {createAccessToken} from './auth.js';
assert.ok(['localhost','127.0.0.1'].includes(new URL(config.databaseUrl).hostname));
const zone=randomUUID(),household=randomUUID(),resident=randomUUID(),shelter=randomUUID(),label=`Outcome verification ${zone}`;
try{
  const [users]=await db.query<any[]>("SELECT user_id,username,role,credential_version FROM users WHERE is_active=1 AND must_change_password=0 AND role IN ('Super Admin','Data Encoder')");
  const admin=users.find(u=>u.role==='Super Admin'),encoder=users.find(u=>u.role==='Data Encoder');assert.ok(admin);assert.ok(encoder,'A local Data Encoder is needed to check role restrictions.');
  const request=async(path:string,method='GET',body?:unknown,expected=200,user:any=admin)=>{
    const response=await fetch(`http://localhost:${config.port}/api/${path}`,{method,headers:{'content-type':'application/json',...(user?{authorization:`Bearer ${createAccessToken({userId:user.user_id,username:user.username,role:user.role,credentialVersion:user.credential_version})}`}:{})},body:body===undefined?undefined:JSON.stringify(body)});
    const text=await response.text();assert.equal(response.status,expected,`${method} ${path}: ${text}`);return text?JSON.parse(text):undefined;
  };
  await db.execute('INSERT INTO zones(zone_id,zone_name,polygon_geojson) VALUES(?,?,?)',[zone,label,JSON.stringify({type:'Polygon',coordinates:[[[.9,.9],[1.1,.9],[1.1,1.1],[.9,1.1],[.9,.9]]]})]);
  await db.execute('INSERT INTO households(household_id,household_number,zone_id,address_line,head_of_household_name) VALUES(?,?,?,?,?)',[household,label,zone,'Test only','Test family']);
  await db.execute('INSERT INTO shelters(shelter_id,shelter_name,zone_id,location_text,latitude,longitude,capacity,contact_person,contact_number) VALUES(?,?,?,?,1,1,1,?,?)',[shelter,label,zone,'Test only','Test contact','Test radio']);
  await db.execute("INSERT INTO residents(resident_id,household_id,full_name,date_of_birth,sex,address_line,evacuation_status,evacuation_shelter_id) VALUES(?,?,?,'1950-01-01','Female','Test only','Evacuated',?)",[resident,household,label,shelter]);
  const body={outcome:'Missing',revision:0,source:'Fictional family report',notes:'Fictional follow-up only',lastSeenLocation:'Test center',observedAt:new Date().toISOString(),confirmed:true};
  await request(`rescue/outcomes/${resident}`,'POST',body,401,null);
  await request(`rescue/outcomes/${resident}`,'POST',{...body,confirmed:false},400);
  await request(`rescue/outcomes/${resident}`,'POST',{...body,source:''},400);
  await request(`rescue/outcomes/${resident}`,'POST',{...body,observedAt:'2099-01-01'},400);
  await request(`rescue/outcomes/${resident}`,'POST',body);
  const yearly=await request(`residents/yearly?search=${encodeURIComponent(label)}`);
  assert.equal(yearly.items.find((r:any)=>r.resident_id===resident)?.outcome,'Missing','The registry editor must receive the current outcome.');
  let profile=await request(`residents/${resident}/details`);assert.equal(profile.resident.outcome,'Missing');assert.equal(profile.resident.evacuation_shelter_id,null);assert.equal(profile.resident.evacuation_status,'For Monitoring');assert.equal(profile.outcomeHistory.length,1);
  assert.ok(Math.abs(Date.parse(profile.outcomeHistory[0].observed_at)-Date.parse(body.observedAt))<1000,'Observation time must round-trip without a timezone shift');
  let dss=await request(`statistics/dss?zone=${zone}`);assert.equal(dss.metrics.residents,1);assert.equal(dss.evacuation.length,0);assert.equal(dss.shelters[0].occupancy,0);
  await request(`rescue/outcomes/${resident}`,'POST',{...body,outcome:'Located'},409);
  await request(`shelters/${shelter}/assignments`,'POST',{residentIds:[resident],evacuationAt:new Date().toISOString()},409);
  await request(`residents/${resident}`,'PUT',{evacuationStatus:'Evacuated',evacuationShelterId:shelter},400);
  await request(`residents/${resident}`,'DELETE',undefined,409);
  await request(`rescue/outcomes/${resident}`,'POST',{...body,outcome:'Located',revision:1,notes:'Fictional resident found'},200,encoder);
  profile=await request(`residents/${resident}/details`);assert.equal(profile.resident.evacuation_status,'For Monitoring','Located must not auto-mark Safe or Evacuated');
  await request(`rescue/outcomes/${resident}`,'POST',{...body,outcome:'Deceased',revision:2},403,encoder);
  await request(`rescue/outcomes/${resident}`,'POST',{...body,outcome:'Deceased',revision:2,source:'Fictional authorized confirmation',notes:'Fictional identity verified'});
  dss=await request(`statistics/dss?zone=${zone}`);assert.equal(dss.metrics.residents,0);assert.equal(dss.evacuation.length,0);
  profile=await request(`residents/${resident}/details`);assert.equal(profile.resident.record_status,'Active','Outcome must preserve registry records');assert.equal(profile.outcomeHistory.length,3);
  await request(`rescue/outcomes/${resident}`,'POST',{...body,outcome:'Located',revision:3},403,encoder);
  await request(`rescue/outcomes/${resident}`,'POST',{...body,outcome:'Located',revision:3,notes:'Fictional correction preserving the prior record'});
  profile=await request(`residents/${resident}/details`);assert.equal(profile.outcomeHistory.length,4);assert.ok(profile.outcomeHistory.some((u:any)=>u.outcome==='Deceased'));assert.equal(profile.resident.outcome,'Located');
  console.log('PASS: missing/deceased/located outcomes, validation, role restrictions, stale revisions, shelter release, operational exclusions, explicit correction, preserved registry and audit history.');
}finally{
  await db.execute('DELETE FROM resident_outcome_updates WHERE resident_id=?',[resident]);await db.execute('DELETE FROM resident_outcomes WHERE resident_id=?',[resident]);
  await db.execute('DELETE FROM evacuation_assignments WHERE resident_id=?',[resident]);await db.execute('DELETE FROM resident_year_snapshots WHERE resident_id=?',[resident]);await db.execute('DELETE FROM residents WHERE resident_id=?',[resident]);
  await db.execute('DELETE FROM household_year_snapshots WHERE household_id=?',[household]);await db.execute('DELETE FROM households WHERE household_id=?',[household]);await db.execute('DELETE FROM shelters WHERE shelter_id=?',[shelter]);await db.execute('DELETE FROM zones WHERE zone_id=?',[zone]);await db.end();console.log('Outcome verification records removed.');
}
