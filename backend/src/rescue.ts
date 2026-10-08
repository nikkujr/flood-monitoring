import {randomUUID} from 'node:crypto';
import {Router} from 'express';
import {z} from 'zod';
import {db} from './db.js';
import {syncShelterOccupancy} from './shelter-occupancy.js';
import {requireAuth,requireRoles} from './auth.js';
import type {AuthRequest} from './types.js';

export const missionTransitions:Record<string,string[]>={Dispatched:['At pickup','Blocked','Cancelled'],'At pickup':['Transporting','Blocked','Cancelled'],Transporting:['Arrived','Blocked'],Blocked:['Dispatched','Cancelled'],Arrived:[],Cancelled:[]};
const text=(max:number)=>z.string().trim().min(1).max(max);
const teamInput=z.object({name:text(120),leaderId:z.string().uuid(),memberIds:z.array(z.string().uuid()).min(1).max(30).transform(ids=>[...new Set(ids)]),vehicle:z.string().trim().max(120).nullish().transform(v=>v||null),passengerCapacity:z.number().int().min(0).max(100).default(0)})
  .refine(t=>t.memberIds.includes(t.leaderId),{message:'Choose a team leader from the selected responders.',path:['leaderId']})
  .refine(t=>!t.vehicle||t.passengerCapacity>0,{message:'Enter passenger spaces when using a vehicle.',path:['passengerCapacity']})
  .transform(t=>({...t,passengerCapacity:t.vehicle?t.passengerCapacity:0}));
const dispatchInput=z.object({teamId:z.string().uuid(),shelterId:z.string().uuid(),residentIds:z.array(z.string().uuid()).min(1).max(100).refine(ids=>new Set(ids).size===ids.length,'Select each resident once'),pickup:text(500),instructions:z.string().trim().max(1000).default(''),expectedStatuses:z.record(z.string().uuid(),text(30))});
const updateInput=z.object({status:z.enum(['At pickup','Transporting','Blocked','Arrived','Cancelled','Dispatched']),revision:z.number().int().positive(),note:z.string().trim().max(1000).default(''),confirmedArrival:z.boolean().default(false),arrivalResidentIds:z.array(z.string().uuid()).min(1).max(100).refine(ids=>new Set(ids).size===ids.length,'Select each arriving resident once').optional()});
const fail=(message:string,status=409)=>{throw Object.assign(new Error(message),{status});};
const wrap=(handler:(req:AuthRequest,res:any)=>Promise<unknown>)=>(req:any,res:any,next:any)=>Promise.resolve(handler(req,res)).catch((error:any)=>{
  if(['ER_LOCK_DEADLOCK','ER_LOCK_WAIT_TIMEOUT'].includes(error?.code))return res.status(409).json({message:'Another official is updating these records. Refresh and retry; your changes were not saved.'});
  return [400,404,409].includes(error?.status)?res.status(error.status).json({message:error.message}):next(error);
});
const json=(value:any)=>typeof value==='string'?JSON.parse(value):value;
async function selectedRoster(c:any,ids:string[],leaderId:string){
  // Transactions use READ COMMITTED: lock known responders, without gap-locking unrelated empty assignment slots.
  const [members]=await c.query('SELECT volunteer_id,full_name,contact_number,responder_type,availability_status FROM volunteers WHERE volunteer_id IN (?) ORDER BY volunteer_id FOR UPDATE',[ids]);
  if(members.length!==ids.length||!members.some((m:any)=>m.volunteer_id===leaderId))fail('A selected responder no longer exists. Review the team roster.');
  const [active]=await c.query('SELECT volunteer_id FROM rescue_active_responders WHERE volunteer_id IN (?) FOR UPDATE',[ids]);
  if(active.length)fail('A selected volunteer or tanod is on a rescue mission. Wait for the mission to finish before changing their team.');
  return members;
}
async function saveMembers(c:any,teamId:string,ids:string[]){
  await c.execute('DELETE FROM rescue_team_members WHERE team_id=?',[teamId]);
  for(const id of ids)await c.execute('INSERT INTO rescue_team_members(team_id,volunteer_id) VALUES(?,?)',[teamId,id]);
}
export const rescueRouter=Router();
rescueRouter.use(requireAuth);
rescueRouter.get('/',wrap(async(_req,res)=>{
  const [teams]=await db.query<any[]>(`SELECT t.*,m.mission_id active_mission_id FROM rescue_teams t LEFT JOIN rescue_missions m ON m.team_id=t.team_id AND m.status NOT IN ('Arrived','Cancelled') ORDER BY t.name`);
  const [responders]=await db.query<any[]>('SELECT v.*,a.mission_id active_mission_id FROM volunteers v LEFT JOIN rescue_active_responders a ON a.volunteer_id=v.volunteer_id ORDER BY v.full_name');
  const [members]=await db.query<any[]>('SELECT * FROM rescue_team_members');
  for(const team of teams)team.members=responders.filter(r=>members.some(m=>m.team_id===team.team_id&&m.volunteer_id===r.volunteer_id));
  const [missions]=await db.query<any[]>(`SELECT * FROM rescue_missions WHERE status NOT IN ('Arrived','Cancelled') OR mission_id IN (SELECT mission_id FROM (SELECT mission_id FROM rescue_missions WHERE status IN ('Arrived','Cancelled') ORDER BY updated_at DESC LIMIT 30) recent) ORDER BY FIELD(status,'Blocked','Dispatched','At pickup','Transporting','Arrived','Cancelled'),created_at`);
  const [updates]=missions.length?await db.query<any[]>(`SELECT u.*,COALESCE(a.full_name,'Former user') recorded_by FROM rescue_updates u LEFT JOIN users a ON a.user_id=u.recorded_by_user_id WHERE mission_id IN (?) ORDER BY u.update_id`,[missions.map(m=>m.mission_id)]):[[]];
  const [outcomes]=await db.query<any[]>(`SELECT o.*,r.full_name,h.household_number,z.zone_name FROM resident_outcomes o JOIN residents r ON r.resident_id=o.resident_id JOIN households h ON h.household_id=r.household_id JOIN zones z ON z.zone_id=h.zone_id ORDER BY o.updated_at DESC`);
  const [outcomeHistory]=await db.query<any[]>('SELECT u.*,COALESCE(a.full_name,\'Former user\') recorded_by FROM resident_outcome_updates u LEFT JOIN users a ON a.user_id=u.recorded_by_user_id ORDER BY u.update_id');
  res.json({teams,responders,outcomes:outcomes.map(o=>({...o,history:outcomeHistory.filter(u=>u.resident_id===o.resident_id)})),missions:missions.map(m=>({...m,residents:json(m.residents).map((p:any)=>({...p,outcome:outcomes.find(o=>o.resident_id===p.id)?.outcome??null})),team_snapshot:json(m.team_snapshot),allowedStatuses:missionTransitions[m.status],updates:updates.filter((u:any)=>u.mission_id===m.mission_id)})),generatedAt:new Date().toISOString()});
}));
rescueRouter.use(requireRoles('Super Admin','Disaster Officer','Data Encoder'));
rescueRouter.post('/outcomes/:id',wrap(async(req,res)=>{
  const id=z.string().uuid().parse(req.params.id);
  const input=z.object({outcome:z.enum(['Missing','Deceased','Located']),revision:z.number().int().min(0),source:text(240),notes:text(1000),lastSeenLocation:text(500),observedAt:z.coerce.date().refine(d=>d.getTime()<=Date.now()+60000,'The observation time cannot be in the future.'),confirmed:z.literal(true)}).parse(req.body);
  const c=await db.getConnection();
  try{await c.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');await c.beginTransaction();
    const [before]=await c.query<any[]>('SELECT evacuation_shelter_id FROM residents WHERE resident_id=?',[id]);if(!before.length)fail('Resident not found.',404);
    const oldShelter=before[0].evacuation_shelter_id;
    if(oldShelter)await c.query('SELECT shelter_id FROM shelters WHERE shelter_id=? FOR UPDATE',[oldShelter]);
    const [people]=await c.query<any[]>('SELECT resident_id,full_name,evacuation_shelter_id FROM residents WHERE resident_id=? FOR UPDATE',[id]);const person=people[0];
    if(!person||person.evacuation_shelter_id!==oldShelter)fail('The resident’s center assignment changed. Refresh and review before recording an outcome.');
    const [current]=await c.query<any[]>('SELECT * FROM resident_outcomes WHERE resident_id=? FOR UPDATE',[id]);
    if((current[0]?.revision??0)!==input.revision)fail('Another official updated this outcome. Refresh and review the latest record.');
    if((input.outcome==='Deceased'||current[0]?.outcome==='Deceased')&&req.user!.role==='Data Encoder'){await c.rollback();return res.status(403).json({message:'A Disaster Officer or Super Admin must record or correct a deceased outcome.'});}
    const observed=input.observedAt;
    await c.execute(`INSERT INTO resident_outcomes(resident_id,outcome,revision,source,notes,last_seen_location,observed_at) VALUES(?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE outcome=VALUES(outcome),revision=VALUES(revision),source=VALUES(source),notes=VALUES(notes),last_seen_location=VALUES(last_seen_location),observed_at=VALUES(observed_at)`,[id,input.outcome,input.revision+1,input.source,input.notes,input.lastSeenLocation,observed]);
    await c.execute('INSERT INTO resident_outcome_updates(resident_id,resident_name,outcome,source,notes,last_seen_location,observed_at,recorded_by_user_id) VALUES(?,?,?,?,?,?,?,?)',[id,person.full_name,input.outcome,input.source,input.notes,input.lastSeenLocation,observed,req.user!.userId]);
    if(input.outcome!=='Located'){
      await c.execute("UPDATE residents SET evacuation_shelter_id=NULL,evacuation_status='For Monitoring' WHERE resident_id=?",[id]);
      if(oldShelter)await syncShelterOccupancy(c,[oldShelter]);
    }
    await c.commit();res.json({message:input.outcome==='Located'?'Resident recorded as Located. Review evacuation needs before assigning shelter space.':`${input.outcome} outcome recorded. Existing missions require review; arrival cannot be confirmed for this resident.`});
  }catch(error){await c.rollback();throw error;}finally{c.release();}
}));
rescueRouter.post('/teams',wrap(async(req,res)=>{
  const input=teamInput.parse(req.body),id=randomUUID(),c=await db.getConnection();
  try {await c.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');await c.beginTransaction();const members=await selectedRoster(c,input.memberIds,input.leaderId),leader=members.find((m:any)=>m.volunteer_id===input.leaderId);
    await c.execute('INSERT INTO rescue_teams(team_id,name,leader,contact,vehicle,passenger_capacity,leader_id) VALUES(?,?,?,?,?,?,?)',[id,input.name,leader.full_name,leader.contact_number,input.vehicle,input.passengerCapacity,input.leaderId]);
    await saveMembers(c,id,input.memberIds);await c.commit();
  }catch(error:any){await c.rollback();if(error.code==='ER_DUP_ENTRY')fail('That team or vehicle is already registered. Use the existing entry.');throw error;}finally{c.release();}
  res.status(201).json({message:'Team saved. Review crew availability before dispatch.'});
}));
rescueRouter.put('/teams/:id',wrap(async(req,res)=>{
  const id=z.string().uuid().parse(req.params.id),input=teamInput.parse(req.body),c=await db.getConnection();
  try{await c.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');await c.beginTransaction();
    const [teams]=await c.query<any[]>('SELECT team_id FROM rescue_teams WHERE team_id=? FOR UPDATE',[id]);if(!teams.length)fail('Team not found.',404);
    const [busy]=await c.query<any[]>("SELECT mission_id FROM rescue_missions WHERE team_id=? AND status NOT IN ('Arrived','Cancelled')",[id]);if(busy.length)fail('Finish or cancel the mission before changing team or vehicle details.');
    const members=await selectedRoster(c,input.memberIds,input.leaderId),leader=members.find((m:any)=>m.volunteer_id===input.leaderId);
    await c.execute('UPDATE rescue_teams SET name=?,leader=?,contact=?,vehicle=?,passenger_capacity=?,leader_id=? WHERE team_id=?',[input.name,leader.full_name,leader.contact_number,input.vehicle,input.passengerCapacity,input.leaderId,id]);
    await saveMembers(c,id,input.memberIds);
    await c.commit();res.json({message:'Team details updated.'});
  }catch(error:any){await c.rollback();if(error.code==='ER_DUP_ENTRY')fail('That team or vehicle is already registered. Use a distinct identifier.');throw error;}finally{c.release();}
}));
rescueRouter.put('/teams/:id/availability',wrap(async(req,res)=>{
  const id=z.string().uuid().parse(req.params.id);
  const {availability}=z.object({availability:z.enum(['Available','Out of service'])}).parse(req.body);
  const c=await db.getConnection();
  try {await c.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');await c.beginTransaction();
    const [teams]=await c.query<any[]>('SELECT team_id FROM rescue_teams WHERE team_id=? FOR UPDATE',[id]);
    if(!teams.length)fail('Team not found.',404);
    const [busy]=await c.query<any[]>("SELECT mission_id FROM rescue_missions WHERE team_id=? AND status NOT IN ('Arrived','Cancelled')",[id]);
    if(busy.length)fail('Finish or cancel the current mission before changing availability.');
    await c.execute('UPDATE rescue_teams SET availability=? WHERE team_id=?',[availability,id]);await c.commit();res.json({message:'Team availability updated.'});
  }catch(error){await c.rollback();throw error;}finally{c.release();}
}));
rescueRouter.post('/missions',wrap(async(req,res)=>{
  const input=dispatchInput.parse(req.body),id=randomUUID();
  const c=await db.getConnection();
  try {await c.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');await c.beginTransaction();
    const [teams]=await c.query<any[]>('SELECT * FROM rescue_teams WHERE team_id=? FOR UPDATE',[input.teamId]);const team=teams[0];
    if(!team||team.availability!=='Available')fail('This team is unavailable. Choose an available team.');
    const [busy]=await c.query<any[]>("SELECT mission_id FROM rescue_missions WHERE team_id=? AND status NOT IN ('Arrived','Cancelled')",[input.teamId]);
    if(busy.length)fail('This team is already on a mission. Refresh and choose another team.');
    const [memberRows]=await c.query<any[]>('SELECT volunteer_id FROM rescue_team_members WHERE team_id=?',[team.team_id]);
    if(!memberRows.length||!team.leader_id)fail('Choose registered volunteers or barangay tanods and a leader in this team’s setup before dispatch.');
    const roster=await selectedRoster(c,memberRows.map(m=>m.volunteer_id),team.leader_id);
    if(roster.some((m:any)=>m.availability_status!=='Available'))fail('A team member is unavailable or assigned elsewhere. Review the responder roster before dispatch.');
    if(team.vehicle&&input.residentIds.length>team.passenger_capacity)fail('The selected residents exceed this vehicle’s passenger capacity. Reduce the group or choose a larger vehicle.');
    const [centers]=await c.query<any[]>('SELECT * FROM shelters WHERE shelter_id=? FOR UPDATE',[input.shelterId]);const center=centers[0];
    if(!center||center.record_status!=='Active'||['Full','Unavailable'].includes(center.status))fail('The destination center is unavailable. Refresh the plan.');
    const [occupancy]=await c.query<any[]>("SELECT COUNT(*) n FROM residents WHERE evacuation_shelter_id=? AND evacuation_status='Evacuated' AND record_status='Active'",[input.shelterId]);
    if(Number(occupancy[0].n)+input.residentIds.length>center.capacity)fail('The destination has insufficient space. Choose another center or a smaller group.');
    const [people]=await c.query<any[]>('SELECT r.resident_id,r.full_name,r.address_line,r.evacuation_status,r.record_status,h.household_number FROM residents r JOIN households h ON h.household_id=r.household_id WHERE r.resident_id IN (?) ORDER BY r.resident_id FOR UPDATE',[input.residentIds]);
    if(people.length!==input.residentIds.length||people.some(r=>r.record_status!=='Active'||r.evacuation_status==='Evacuated'||input.expectedStatuses[r.resident_id]!==r.evacuation_status))fail('Resident records changed. Refresh the plan before sending a team.');
    const [unlocated]=await c.query<any[]>("SELECT resident_id FROM resident_outcomes WHERE resident_id IN (?) AND outcome IN ('Missing','Deceased') FOR UPDATE",[input.residentIds]);
    if(unlocated.length)fail('A resident is recorded Missing or Deceased. Use the outcome follow-up list; they cannot receive ordinary evacuation placement.');
    const [active]=await c.query<any[]>('SELECT resident_id FROM rescue_active_residents WHERE resident_id IN (?)',[input.residentIds]);
    if(active.length)fail('A selected resident already has a rescue team assigned. Refresh to view that mission.');
    await c.execute("INSERT INTO rescue_missions(mission_id,team_id,shelter_id,pickup,instructions,status,residents,team_snapshot,shelter_name) VALUES(?,?,?,?,?,'Dispatched',?,?,?)",[id,input.teamId,input.shelterId,input.pickup,input.instructions,JSON.stringify(people.map(r=>({id:r.resident_id,name:r.full_name,household:r.household_number,address:r.address_line,status:r.evacuation_status}))),JSON.stringify({...team,members:roster}),center.shelter_name]);
    for(const member of roster)await c.execute('INSERT INTO rescue_active_responders(volunteer_id,mission_id) VALUES(?,?)',[member.volunteer_id,id]);
    for(const person of people)await c.execute('INSERT INTO rescue_active_residents(resident_id,mission_id) VALUES(?,?)',[person.resident_id,id]);
    await c.execute("INSERT INTO rescue_updates(mission_id,status,note,recorded_by_user_id) VALUES(?,'Dispatched',?,?)",[id,input.instructions,req.user!.userId]);
    await c.commit();res.status(201).json({missionId:id,message:'Team dispatched. Update progress in Missions.'});
  }catch(error:any){await c.rollback();if(error.code==='ER_DUP_ENTRY')fail('A resident was assigned by another official. Refresh the mission list.');throw error;}finally{c.release();}
}));
rescueRouter.post('/missions/:id/status',wrap(async(req,res)=>{
  const id=z.string().uuid().parse(req.params.id),input=updateInput.parse(req.body);
  const c=await db.getConnection();
  try {await c.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');await c.beginTransaction();
    // Lock the team before its mission, matching dispatch and availability lock order.
    const [found]=await c.query<any[]>('SELECT team_id FROM rescue_missions WHERE mission_id=?',[id]);if(!found.length)fail('Mission not found.',404);
    await c.query('SELECT team_id FROM rescue_teams WHERE team_id=? FOR UPDATE',[found[0].team_id]);
    const [rows]=await c.query<any[]>('SELECT * FROM rescue_missions WHERE mission_id=? FOR UPDATE',[id]);const mission=rows[0];
    if(mission.revision!==input.revision)fail('Another official updated this mission. Refresh and review the latest step.');
    if(!missionTransitions[mission.status]?.includes(input.status))fail('That step is not available from the mission’s current status.');
    if(['Blocked','Cancelled'].includes(input.status)&&!input.note)fail('Enter a reason so the next official knows what happened.',400);
    if(input.status==='Arrived'){
      if(!input.confirmedArrival)fail('Confirm that every listed resident has physically arrived.',400);
      const people=json(mission.residents),allIds=people.map((p:any)=>p.id),ids=input.arrivalResidentIds??allIds;
      if(ids.some((id:string)=>!allIds.includes(id)))fail('An arriving resident is not part of this mission.',400);
      const [centers]=await c.query<any[]>('SELECT * FROM shelters WHERE shelter_id=? FOR UPDATE',[mission.shelter_id]);const center=centers[0];
      if(!center||center.record_status!=='Active'||['Full','Unavailable'].includes(center.status))fail('The destination is unavailable. Record a blocked mission and coordinate with the center.');
      const [allResidents]=await c.query<any[]>('SELECT resident_id,record_status,evacuation_status FROM residents WHERE resident_id IN (?) ORDER BY resident_id FOR UPDATE',[allIds]);
      const residents=allResidents.filter(r=>ids.includes(r.resident_id));
      if(residents.length!==ids.length||residents.some(r=>r.record_status!=='Active'||r.evacuation_status==='Evacuated'))fail('A resident is unavailable or already evacuated. Arrival was not saved; review the resident records.');
      const [unlocated]=await c.query<any[]>("SELECT resident_id,outcome FROM resident_outcomes WHERE resident_id IN (?) AND outcome IN ('Missing','Deceased') FOR UPDATE",[allIds]);
      if(unlocated.some(r=>ids.includes(r.resident_id)))fail('A listed resident is Missing or Deceased. Arrival was not saved. Review the mission.');
      if(allIds.some((id:string)=>!ids.includes(id)&&!unlocated.some(r=>r.resident_id===id)))fail('Record a Missing or confirmed Deceased outcome for each excluded resident before completing this mission.');
      const [occupancy]=await c.query<any[]>("SELECT COUNT(*) n FROM residents WHERE evacuation_shelter_id=? AND evacuation_status='Evacuated' AND record_status='Active'",[mission.shelter_id]);
      if(Number(occupancy[0].n)+ids.length>center.capacity)fail('The center no longer has enough space. Arrival was not saved; coordinate with the center.');
      for(const person of residents){
        await c.execute("UPDATE residents SET evacuation_status='Evacuated',evacuation_shelter_id=? WHERE resident_id=?",[mission.shelter_id,person.resident_id]);
        await c.execute("INSERT INTO evacuation_assignments(assignment_id,resident_id,shelter_id,action,evacuation_at,recorded_by_user_id) VALUES(?,?,?,'Assigned',CURRENT_TIMESTAMP(),?)",[randomUUID(),person.resident_id,mission.shelter_id,req.user!.userId]);
      }
      await syncShelterOccupancy(c,[mission.shelter_id]);
      await c.execute('UPDATE rescue_missions SET residents=? WHERE mission_id=?',[JSON.stringify(people.map((p:any)=>({...p,arrivalStatus:ids.includes(p.id)?'Arrived':unlocated.find(r=>r.resident_id===p.id)?.outcome}))),id]);
    }
    await c.execute("UPDATE rescue_missions SET status=?,revision=revision+1,arrived_at=IF(?='Arrived',CURRENT_TIMESTAMP(3),NULL) WHERE mission_id=?",[input.status,input.status,id]);
    await c.execute('INSERT INTO rescue_updates(mission_id,status,note,recorded_by_user_id) VALUES(?,?,?,?)',[id,input.status,input.note,req.user!.userId]);
    if(['Arrived','Cancelled'].includes(input.status)){await c.execute('DELETE FROM rescue_active_residents WHERE mission_id=?',[id]);await c.execute('DELETE FROM rescue_active_responders WHERE mission_id=?',[id]);}
    await c.commit();res.json({message:input.status==='Arrived'?'Arrival confirmed. Resident statuses and shelter occupancy updated; team is available again.':input.status==='Cancelled'?'Mission cancelled. Residents can be assigned again; team is available.':'Mission updated.'});
  }catch(error){await c.rollback();throw error;}finally{c.release();}
}));
