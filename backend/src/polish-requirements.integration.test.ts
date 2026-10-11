import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {db} from './db.js';
import {config} from './config.js';
import {createAccessToken} from './auth.js';

assert.ok(['localhost','127.0.0.1'].includes(new URL(config.databaseUrl).hostname), 'Use a local test database.');
const zone=randomUUID(),otherZone=randomUUID(),users:string[]=[],households:string[]=[],residents:string[]=[],reports:string[]=[];
const label=`Polish ${randomUUID()}`;
try {
  const [admins]=await db.query<any[]>("SELECT user_id,username,role,credential_version FROM users WHERE role='Super Admin' AND is_active=1 AND must_change_password=0 LIMIT 1");
  assert.ok(admins[0]);
  const admin=createAccessToken({userId:admins[0].user_id,username:admins[0].username,role:admins[0].role,credentialVersion:admins[0].credential_version});
  const request=async(path:string,method='GET',body?:unknown,token:string|undefined=admin,status=200)=>{
    const response=await fetch(`http://localhost:${config.port}/api/${path}`,{method,headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},body:body===undefined?undefined:JSON.stringify(body)});
    const text=await response.text();assert.equal(response.status,status,`${method} ${path}: ${text}`);return text?JSON.parse(text):null;
  };
  const account={fullName:label,username:label,email:`${randomUUID()}@example.test`,password:'TestPassword123',role:'Resident'};
  const created=await request('users','POST',account,admin,201);users.push(created.userId);
  const login=await request('auth/login','POST',{username:account.username,password:account.password},undefined);
  const me=await request('auth/me','GET',undefined,login.accessToken);assert.equal(me.resident,null);
  await request('auth/change-password','POST',{currentPassword:account.password,newPassword:'ChangedPassword123'},login.accessToken);
  const signedIn=await request('auth/login','POST',{username:account.username,password:'ChangedPassword123'},undefined);
  await request('flood-reports','POST',{},signedIn.accessToken,403);
  const geometry=JSON.stringify({type:'Polygon',coordinates:[[[122.884,13.782],[122.886,13.782],[122.886,13.784],[122.884,13.784],[122.884,13.782]]]});
  // A test suffix keeps zone names distinct while retaining the numbering prefix.
  await db.execute('INSERT INTO zones(zone_id,zone_name,polygon_geojson) VALUES(?,?,?),(?,?,?)',[zone,`Zone 98 ${label}`,geometry,otherZone,`Zone 97 ${label}`,geometry]);
  const save=async(zoneId:string)=>{const result=await request('households','POST',{zoneId,addressLine:'Colacling',headOfHouseholdName:label},admin,201);households.push(result.id);return (await request(`households/${result.id}`)).household_number;};
  assert.equal(await save(zone),'Z98-1');
  await db.execute('UPDATE households SET household_number=? WHERE household_id=?',['Z98-53',households[0]!]);
  const numbers=await Promise.all([save(zone),save(zone)]);assert.deepEqual(numbers.sort(),['Z98-54','Z98-55']);
  assert.equal(await save(otherZone),'Z97-1');
  const input={fullName:label,username:`register-${randomUUID()}`,email:`${randomUUID()}@example.test`,password:'TestPassword123',dateOfBirth:'2000-01-01',contactNumber:'09123456789',zoneId:zone};
  await request('auth/register','POST',{...input,zoneId:randomUUID()},undefined,400);
  await request('auth/register','POST',input,undefined,201);
  const [registered]=await db.query<any[]>('SELECT user_id FROM users WHERE username=?',[input.username]);const id=registered[0].user_id;users.push(id);
  const [registration]=await db.query<any[]>('SELECT zone_id,address_line,household_number FROM resident_registrations WHERE user_id=?',[id]);
  assert.equal(registration[0].zone_id,zone);assert.equal(registration[0].address_line,'Colacling');assert.equal(registration[0].household_number,null);
  await request('auth/login','POST',{username:input.username,password:input.password},undefined,403);
  await request(`resident-registrations/${id}/review`,'POST',{status:'Approved',confirmed:false},admin,400);
  await request(`resident-registrations/${id}/review`,'POST',{status:'Approved',confirmed:true},admin);
  const approved=await request('auth/login','POST',{username:input.username,password:input.password},undefined);
  assert.equal((await request('auth/me','GET',undefined,approved.accessToken)).registration.status,'Approved');
  await request('flood-reports','POST',{},approved.accessToken,403);
  const addedInput={...input,username:`register-${randomUUID()}`,email:`${randomUUID()}@example.test`};
  await request('auth/register','POST',addedInput,undefined,201);
  const [newUsers]=await db.query<any[]>('SELECT user_id FROM users WHERE username=?',[addedInput.username]);const addedId=newUsers[0].user_id;users.push(addedId);
  const newResident={fullName:label,dateOfBirth:input.dateOfBirth,contactNumber:input.contactNumber,addressLine:'Colacling',sex:'Female',priorityLevel:'Low',zoneId:zone};
  const review=`resident-registrations/${addedId}/review`;
  await request(review,'POST',{status:'Approved',confirmed:true,newResident:{...newResident,contactNumber:'invalid'}},admin,400);
  const [afterInvalid]=await db.query<any[]>('SELECT household_id FROM households WHERE zone_id=?',[zone]);assert.equal(afterInvalid.length,3,'Failed resident validation must roll back household creation.');
  await request(review,'POST',{status:'Approved',confirmed:true,newResident},admin);
  const [linked]=await db.query<any[]>('SELECT r.resident_id,r.household_id,h.household_number,h.verification_status FROM resident_accounts a JOIN residents r ON r.resident_id=a.resident_id JOIN households h ON h.household_id=r.household_id WHERE a.user_id=?',[addedId]);
  residents.push(linked[0].resident_id);households.push(linked[0].household_id);
  assert.equal(linked[0].household_number,'Z98-56');assert.equal(linked[0].verification_status,'Verified');
  const linkedLogin=await request('auth/login','POST',{username:addedInput.username,password:addedInput.password},undefined);
  const submitted=await request('flood-reports','POST',{locationText:'Colacling',incidentType:'Road Flooding',severityLevel:'Information',latitude:13.7828976,longitude:122.8852784},linkedLogin.accessToken,201);reports.push(submitted.reportId);
  await db.execute("UPDATE flood_reports SET created_at='2001-01-01 00:00:00' WHERE report_id=?",[submitted.reportId]);
  const period='statistics/dss?from=2001-01-01&to=2001-01-07';
  const initial=await request(period);assert.equal(initial.incidents.records.find((record:any)=>record.id===submitted.reportId).status,'Submitted');
  await db.execute("UPDATE flood_reports SET status='Resolved' WHERE report_id=?",[submitted.reportId]);
  const refreshed=await request(period);assert.equal(refreshed.incidents.records.find((record:any)=>record.id===submitted.reportId).status,'Resolved');
  console.log('PASS: optional resident links, approval without a link, pending denial, reporting safeguards, registration zones/default address and concurrent per-zone household numbering.');
  console.log('PASS: new household and resident approval, atomic rollback, generated numbering and freshly updated weekly incident records.');
} finally {
  for(const id of reports){await db.execute('DELETE FROM flood_report_zones WHERE report_id=?',[id]);await db.execute('DELETE FROM flood_reports WHERE report_id=?',[id]);}
  for(const id of users){await db.execute('DELETE FROM refresh_tokens WHERE user_id=?',[id]);await db.execute('DELETE FROM resident_accounts WHERE user_id=?',[id]);await db.execute('DELETE FROM users WHERE user_id=?',[id]);}
  for(const id of residents)await db.execute('DELETE FROM residents WHERE resident_id=?',[id]);
  for(const id of households)await db.execute('DELETE FROM households WHERE household_id=?',[id]);
  await db.execute('DELETE FROM zones WHERE zone_id IN (?,?)',[zone,otherZone]);
  await db.end();
}
