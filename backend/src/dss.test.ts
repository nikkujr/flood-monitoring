import assert from 'node:assert/strict';
import { assessRisk, buildDss, type Report, type DssSource } from './dss.js';
const report = (id:string,severity='Information',status='Validated'):Report => ({report_id:id,tracking_code:`BB-${id}`,location_text:'Test location',severity_level:severity,status,created_at:'2026-10-07 10:00:00',incident_type:'River Flooding'});
for (const [reports,vulnerable,risk,rule] of [
  [[],0,'Low','No active'],
  [[report('1')],0,'Moderate','At least 1'],
  [[report('1','Minor Incident'),report('2','Minor Incident')],0,'High','At least 2'],
  [[report('1','Major Incident')],0,'High','major incident'],
  [[report('1'),report('2'),report('3')],0,'High','At least 3'],
  [[report('1','Major Incident'),report('2')],1,'Critical','registered vulnerable'],
  [Array.from({length:5},(_,i)=>report(String(i))),0,'Critical','At least 5'],
  [[report('1','Major Incident','Submitted'),report('2','Major Incident','Resolved')],1,'Low','No active']
] as [Report[],number,string,string][]) {
  const decision=assessRisk(reports,vulnerable);
  assert.equal(decision.risk,risk);
  assert.ok(decision.rule.includes(rule));
}
const reports=Array.from({length:12},(_,i)=>report(String(i)));
reports.push(report('pending','Major Incident','Under Review'),report('unassigned'));
const source:DssSource={zones:[{zone_id:'z',zone_name:'Test Zone'}],households:[],residents:[],reports,reportZones:reports.filter(r=>r.report_id!=='unassigned').map(r=>({report_id:r.report_id,zone_id:'z'})),shelters:[{shelter_id:'s',shelter_name:'Test Center',zone_id:'z',location_text:'Test Zone',capacity:100,current_occupancy:null,status:'Available'}]};
const data=buildDss(source,{},new Date('2026-10-07T02:00:00Z'));
assert.equal(data.zones[0]!.evidence.length,12);
assert.ok(data.zones[0]!.evidence.every(r=>r.code!=='BB-pending'));
assert.equal(data.incidents.activeRecords.length,13);
assert.equal(data.incidents.recent.length,10);
assert.equal(data.coverage.unassignedActive,1);
assert.equal(data.shelters[0]!.available,null);
assert.ok(data.zones[0]!.rule.includes('At least 5'));
const filtered=buildDss(source,{severity:'Major Incident'});
assert.equal(filtered.zones[0]!.risk,'Low');
assert.equal(filtered.zones[0]!.evidence.length,0);
assert.equal(filtered.incidents.activeRecords.length,0);
const lowZone = structuredClone(source);
lowZone.reports = [];
lowZone.reportZones = [];
lowZone.households = [{household_id:'h',household_number:'H-1',zone_id:'z',address_line:'Test',head_of_household_name:'Test'}];
lowZone.residents = [{resident_id:'r',household_id:'h',full_name:'Test Resident',date_of_birth:null,address_line:'Test',vulnerability_type:null,vulnerability_other:null,pwd_specify:null,morbidity:null,can_swim:null,house_type:null,priority_level:'Low',evacuation_status:'For Evacuation'}];
assert.equal(buildDss(lowZone,{}).evacuation.length,1);
lowZone.residents[0]!.evacuation_status = 'Safe';
assert.equal(buildDss(lowZone,{}).evacuation.length,0);
lowZone.residents[0]!.evacuation_status = 'Evacuated';
assert.equal(buildDss(lowZone,{}).evacuation.length,0);
console.log('Risk rules, evidence, filters, unknown capacity, and explicit evacuation queue passed.');
