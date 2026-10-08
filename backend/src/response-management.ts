import { Router } from 'express';
import { z } from 'zod';
import { db } from './db.js';
import { requireAuth, requireRoles } from './auth.js';
import { loadDss } from './dss-api.js';

export const responseStatuses = ['For Review','Pending','In Progress','Completed'] as const;
export function canAdvanceResponse(current: string, next: string) {
  const index = responseStatuses.indexOf(current as typeof responseStatuses[number]);
  return index >= 0 && (next === current || next === responseStatuses[index + 1]);
}
export function responseSuggestions(data: Awaited<ReturnType<typeof loadDss>>) {
  return [
    ...data.zones.filter(z => z.activeReports > 0).map(z => ({key:`zone:${z.id}`,label:z.name,priority:z.risk === 'Critical' ? 'Highest' : z.risk === 'High' ? 'High' : 'Medium',action:z.response,basis:z.explanation})),
    ...data.priorityHouseholds.map(h => ({key:`household:${h.id}`,label:`${h.number} · ${h.zone}`,priority:h.priority,action:'Assess household needs and coordinate evacuation assistance.',basis:`${h.risk} zone; ${h.vulnerabilities.join(', ') || 'Zone risk or recorded evacuation need'}`}))
  ];
}

const wrap = (handler: (req: any, res: any) => Promise<unknown>) =>
  (req: any, res: any, next: any) => Promise.resolve(handler(req,res)).catch(next);
export const responseManagementRouter = Router();
responseManagementRouter.use(requireAuth);
responseManagementRouter.get('/', wrap(async (_req,res) => {
  const suggestions = responseSuggestions(await loadDss({}));
  // ponytail: one action per zone or household; introduce incident-scoped keys if repeated response campaigns are needed.
  // Stable source keys keep refreshes from duplicating suggestions or resetting operational progress.
  for (const s of suggestions) await db.execute(`INSERT IGNORE INTO response_actions(source_key,target_label,priority,response_action,basis) VALUES(?,?,?,?,?)`,[s.key,s.label,s.priority,s.action,s.basis]);
  const [items] = await db.query<any[]>(`SELECT a.*,t.name team_name FROM response_actions a LEFT JOIN rescue_teams t ON t.team_id=a.team_id ORDER BY FIELD(a.priority,'Highest','High','Medium','Lower'),a.created_at`);
  const [teams] = await db.query<any[]>('SELECT team_id,name,availability FROM rescue_teams ORDER BY name');
  const [updates] = await db.query<any[]>(`SELECT h.*,COALESCE(u.full_name,'Former user') recorded_by FROM response_action_updates h LEFT JOIN users u ON u.user_id=h.recorded_by_user_id ORDER BY h.update_id DESC`);
  res.json({items:items.map(item => {
    const suggestion = suggestions.find(s => s.key === item.source_key);
    return {...item,suggestionCurrent:!!suggestion,suggestionChanged:!!suggestion && (suggestion.priority !== item.priority || suggestion.action !== item.response_action || suggestion.basis !== item.basis),history:updates.filter(h=>h.source_key === item.source_key)};
  }),teams,generatedAt:new Date().toISOString()});
}));
responseManagementRouter.put('/:key', requireRoles('Super Admin','Disaster Officer'), wrap(async (req,res) => {
  const key = z.string().regex(/^(zone|household):[0-9a-f-]{36}$/i).parse(req.params.key);
  const input = z.object({teamId:z.string().uuid().nullable(),status:z.enum(responseStatuses),revision:z.number().int().min(0),note:z.string().trim().min(1).max(1000),confirmed:z.boolean().default(false)}).parse(req.body);
  const c = await db.getConnection();
  try {
    await c.beginTransaction();
    const [rows] = await c.query<any[]>('SELECT * FROM response_actions WHERE source_key=? FOR UPDATE',[key]);
    const row = rows[0];
    if (!row) { await c.rollback(); return res.status(404).json({message:'Response action not found.'}); }
    if (row.revision !== input.revision) { await c.rollback(); return res.status(409).json({message:'Another official updated this action. Refresh and review the latest record.'}); }
    if (row.status === 'Completed') { await c.rollback(); return res.status(409).json({message:'Completed actions retain their recorded confirmation.'}); }
    if (!canAdvanceResponse(row.status,input.status)) { await c.rollback(); return res.status(400).json({message:'Advance one step: For Review → Pending → In Progress → Completed.'}); }
    if (input.status !== 'For Review' && !input.teamId) { await c.rollback(); return res.status(400).json({message:'Assign a team before approving the action.'}); }
    if (input.status === 'Completed' && !input.confirmed) { await c.rollback(); return res.status(400).json({message:'Confirm completion with the assigned team before saving.'}); }
    if (input.teamId) {
      const [teams] = await c.query<any[]>('SELECT team_id FROM rescue_teams WHERE team_id=?',[input.teamId]);
      if (!teams.length) { await c.rollback(); return res.status(400).json({message:'The selected team no longer exists.'}); }
    }
    await c.execute('UPDATE response_actions SET team_id=?,status=?,latest_update=?,revision=revision+1 WHERE source_key=?',[input.teamId,input.status,input.note,key]);
    await c.execute('INSERT INTO response_action_updates(source_key,team_id,status,note,recorded_by_user_id) VALUES(?,?,?,?,?)',[key,input.teamId,input.status,input.note,req.user!.userId]);
    await c.commit();
    res.json({message:'Response action updated.'});
  } catch (error) { await c.rollback(); throw error; }
  finally { c.release(); }
}));
