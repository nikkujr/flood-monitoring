import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db } from './db.js';
import { requireAuth, requireRoles, requireValidatedResident } from './auth.js';

export const checkInInput = z.object({
  kind:z.enum(['Need help','Safe at home','Reached shelter']),
  location:z.string().trim().min(5).max(500),
  needs:z.string().trim().max(1000).default('')
}).strict().superRefine((input,ctx)=>{
  if(input.kind==='Need help'&&!input.needs)ctx.addIssue({code:'custom',path:['needs'],message:'Describe the assistance you need.'});
});
const reviewInput=z.object({status:z.enum(['Acknowledged','Closed']),revision:z.number().int().min(0),note:z.string().trim().min(1).max(1000),confirmed:z.literal(true)}).strict();
const contactInput=z.object({status:z.enum(['Not contacted','Contacted','Needs follow-up']),assignedUserId:z.string().uuid().nullable(),revision:z.number().int().min(0),note:z.string().trim().min(1).max(1000)}).strict();
const staff=requireRoles('Super Admin','Disaster Officer','Data Encoder');
const wrap=(handler:(req:any,res:any)=>Promise<unknown>)=>(req:any,res:any,next:any)=>Promise.resolve(handler(req,res)).catch(next);
export const communitySupportRouter=Router();
communitySupportRouter.use(requireAuth);

communitySupportRouter.get('/mine',requireValidatedResident,wrap(async(req,res)=>{
  const [items]=await db.query<any[]>('SELECT * FROM assistance_requests WHERE resident_id=? ORDER BY created_at DESC LIMIT 20',[req.resident.resident_id]);
  res.json({items});
}));
communitySupportRouter.post('/mine',requireValidatedResident,wrap(async(req,res)=>{
  const input=checkInInput.parse(req.body),id=randomUUID(),c=await db.getConnection();
  try{
    await c.beginTransaction();
    await c.query('SELECT resident_id FROM residents WHERE resident_id=? FOR UPDATE',[req.resident.resident_id]);
    // A second request must not silently replace an unresolved request for help.
    const [open]=await c.query<any[]>("SELECT request_id FROM assistance_requests WHERE resident_id=? AND kind='Need help' AND status!='Closed' LIMIT 1",[req.resident.resident_id]);
    if(input.kind==='Need help'&&open.length){await c.rollback();return res.status(409).json({message:'You already have an open request for help. Contact the barangay for urgent changes.'});}
    await c.execute('INSERT INTO assistance_requests(request_id,resident_id,household_id,submitted_by_user_id,kind,location,needs) SELECT ?,r.resident_id,r.household_id,?,?,?,? FROM residents r WHERE r.resident_id=?',[id,req.user.userId,input.kind,input.location,input.needs,req.resident.resident_id]);
    await c.commit();res.status(201).json({message:'Check-in submitted for staff review.',requestId:id});
  }catch(error){await c.rollback();throw error;}finally{c.release();}
}));

function listInput(req:any){
  return z.object({page:z.coerce.number().int().min(1).default(1),pageSize:z.coerce.number().int().min(1).max(100).default(20),search:z.string().trim().max(160).default('')}).parse(req.query);
}
communitySupportRouter.get('/requests',staff,wrap(async(req,res)=>{
  const {page,pageSize,search}=listInput(req);
  const status=z.enum(['','Submitted','Acknowledged','Closed']).parse(req.query.filter_status??'');
  const where="WHERE (?='' OR a.status=?) AND (r.full_name LIKE ? OR h.household_number LIKE ? OR a.location LIKE ?)";
  const params=[status,status,...Array(3).fill(`%${search}%`)];
  const from='FROM assistance_requests a JOIN residents r ON r.resident_id=a.resident_id JOIN households h ON h.household_id=a.household_id';
  const [items]=await db.query<any[]>(`SELECT a.*,r.full_name,r.contact_number,r.record_status,r.evacuation_status,h.household_number,z.zone_name,o.outcome,ar.mission_id ${from} JOIN zones z ON z.zone_id=h.zone_id LEFT JOIN resident_outcomes o ON o.resident_id=r.resident_id LEFT JOIN rescue_active_residents ar ON ar.resident_id=r.resident_id ${where} ORDER BY (a.status='Closed'),(a.kind='Need help') DESC,a.created_at,a.request_id LIMIT ? OFFSET ?`,[...params,pageSize,(page-1)*pageSize]);
  const [[count]]=await db.query<any[]>(`SELECT COUNT(*) total ${from} ${where}`,params);
  res.json({items,page,pageSize,totalItems:count.total,totalPages:Math.ceil(count.total/pageSize)});
}));
communitySupportRouter.get('/requests/:id',staff,wrap(async(req,res)=>{
  const id=z.string().uuid().parse(req.params.id);
  const [history]=await db.query<any[]>('SELECT a.*,COALESCE(u.full_name,\'Former staff member\') recorded_by FROM assistance_request_updates a LEFT JOIN users u ON u.user_id=a.recorded_by_user_id WHERE a.request_id=? ORDER BY a.update_id DESC',[id]);
  res.json({history});
}));
communitySupportRouter.put('/requests/:id',staff,wrap(async(req,res)=>{
  const id=z.string().uuid().parse(req.params.id),input=reviewInput.parse(req.body),c=await db.getConnection();
  try{
    await c.beginTransaction();
    const [[row]]=await c.query<any[]>('SELECT * FROM assistance_requests WHERE request_id=? FOR UPDATE',[id]);
    if(!row){await c.rollback();return res.status(404).json({message:'Request not found.'});}
    if(row.revision!==input.revision||row.status==='Closed'){await c.rollback();return res.status(409).json({message:'This request changed or was closed. Refresh before reviewing it.'});}
    await c.execute('UPDATE assistance_requests SET status=?,review_note=?,revision=revision+1 WHERE request_id=?',[input.status,input.note,id]);
    await c.execute('INSERT INTO assistance_request_updates(request_id,status,note,recorded_by_user_id) VALUES(?,?,?,?)',[id,input.status,input.note,req.user.userId]);
    await c.commit();res.json({message:'Request review recorded.'});
  }catch(error){await c.rollback();throw error;}finally{c.release();}
}));

communitySupportRouter.get('/households',staff,wrap(async(req,res)=>{
  // ponytail: one ongoing contact state per household; scope contacts to incidents when separate response campaigns are needed.
  const {page,pageSize,search}=listInput(req);
  const status=z.enum(['','Not contacted','Contacted','Needs follow-up']).parse(req.query.filter_status??'');
  const from="FROM households h JOIN zones z ON z.zone_id=h.zone_id LEFT JOIN household_contacts c ON c.household_id=h.household_id";
  const where="WHERE h.verification_status='Verified' AND EXISTS(SELECT 1 FROM residents r WHERE r.household_id=h.household_id AND r.record_status='Active') AND (?='' OR COALESCE(c.status,'Not contacted')=?) AND (h.household_number LIKE ? OR h.head_of_household_name LIKE ? OR z.zone_name LIKE ?)";
  const params=[status,status,...Array(3).fill(`%${search}%`)];
  const [items]=await db.query<any[]>(`SELECT h.household_id,h.household_number,h.head_of_household_name,h.address_line,h.contact_number,z.zone_name,COALESCE(c.status,'Not contacted') status,COALESCE(c.revision,0) revision,c.assigned_user_id,c.note,c.updated_at,u.full_name assigned_name,
    (SELECT COUNT(*) FROM assistance_requests a WHERE a.household_id=h.household_id AND a.kind='Need help' AND a.status!='Closed') open_requests,
    (SELECT COUNT(*) FROM residents r WHERE r.household_id=h.household_id AND r.record_status='Active' AND (r.priority_level='High' OR TIMESTAMPDIFF(YEAR,r.date_of_birth,CURDATE())>=60 OR TIMESTAMPDIFF(YEAR,r.date_of_birth,CURDATE())<18)) priority_members
    ${from} LEFT JOIN users u ON u.user_id=c.assigned_user_id ${where} ORDER BY open_requests DESC,FIELD(COALESCE(c.status,'Not contacted'),'Needs follow-up','Not contacted','Contacted'),priority_members DESC,h.household_number,h.household_id LIMIT ? OFFSET ?`,[...params,pageSize,(page-1)*pageSize]);
  const [[count]]=await db.query<any[]>(`SELECT COUNT(*) total ${from} ${where}`,params);
  const [staffMembers]=await db.query<any[]>("SELECT user_id,full_name FROM users WHERE is_active=1 AND role IN ('Super Admin','Disaster Officer','Data Encoder') ORDER BY full_name");
  res.json({items,staffMembers,page,pageSize,totalItems:count.total,totalPages:Math.ceil(count.total/pageSize)});
}));
communitySupportRouter.get('/households/:id',staff,wrap(async(req,res)=>{
  const id=z.string().uuid().parse(req.params.id);
  const [history]=await db.query<any[]>('SELECT c.*,COALESCE(u.full_name,\'Former staff member\') recorded_by,assigned.full_name assigned_name FROM household_contact_updates c LEFT JOIN users u ON u.user_id=c.recorded_by_user_id LEFT JOIN users assigned ON assigned.user_id=c.assigned_user_id WHERE c.household_id=? ORDER BY c.update_id DESC',[id]);
  res.json({history});
}));
communitySupportRouter.put('/households/:id',staff,wrap(async(req,res)=>{
  const id=z.string().uuid().parse(req.params.id),input=contactInput.parse(req.body),c=await db.getConnection();
  try{
    await c.beginTransaction();
    const [[household]]=await c.query<any[]>('SELECT household_id,verification_status FROM households WHERE household_id=? FOR UPDATE',[id]);
    if(!household||household.verification_status!=='Verified'){await c.rollback();return res.status(409).json({message:'Select an existing verified household.'});}
    const [[row]]=await c.query<any[]>('SELECT revision FROM household_contacts WHERE household_id=?',[id]);
    if((row?.revision??0)!==input.revision){await c.rollback();return res.status(409).json({message:'Another staff member updated this household. Refresh before saving.'});}
    if(input.assignedUserId){
      const [users]=await c.query<any[]>("SELECT user_id FROM users WHERE user_id=? AND is_active=1 AND role IN ('Super Admin','Disaster Officer','Data Encoder')",[input.assignedUserId]);
      if(!users.length){await c.rollback();return res.status(400).json({message:'Assign an active barangay staff member.'});}
    }
    await c.execute('INSERT INTO household_contacts(household_id,status,assigned_user_id,note,revision) VALUES(?,?,?,?,1) ON DUPLICATE KEY UPDATE status=VALUES(status),assigned_user_id=VALUES(assigned_user_id),note=VALUES(note),revision=revision+1',[id,input.status,input.assignedUserId,input.note]);
    await c.execute('INSERT INTO household_contact_updates(household_id,status,assigned_user_id,note,recorded_by_user_id) VALUES(?,?,?,?,?)',[id,input.status,input.assignedUserId,input.note,req.user.userId]);
    await c.commit();res.json({message:'Household contact update recorded.'});
  }catch(error){await c.rollback();throw error;}finally{c.release();}
}));
