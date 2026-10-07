import { z } from 'zod';
import { buildDss, type DssSource } from './dss.js';

export const simulationInput = z.object({
  zoneId:z.string().uuid().optional(),
  additionalMajorReports:z.number().int().min(0).max(10).default(0),
  unavailableShelterIds:z.array(z.string().uuid()).max(100).default([])
}).refine(s=>!s.additionalMajorReports || !!s.zoneId,{message:'Choose a zone for the additional incidents',path:['zoneId']});

export function simulateDss(source:DssSource, scenario:z.infer<typeof simulationInput>, now=new Date()) {
  if ((scenario.zoneId && !source.zones.some(z=>z.zone_id===scenario.zoneId)) || scenario.unavailableShelterIds.some(id=>!source.shelters.some(s=>s.shelter_id===id))) {
    throw Object.assign(new Error('A selected zone or operational center no longer exists. Refresh the planner.'),{status:400});
  }
  const changed=structuredClone(source);
  for (const shelter of changed.shelters) if (scenario.unavailableShelterIds.includes(shelter.shelter_id)) shelter.status='Unavailable';
  for (let i=0;i<scenario.additionalMajorReports;i++) {
    const id=`simulation-${i}`;
    changed.reports.push({report_id:id,tracking_code:`SIMULATION-${i+1}`,location_text:'Hypothetical incident',incident_type:'River Flooding',severity_level:'Major Incident',status:'Validated',created_at:now.toISOString()});
    changed.reportZones.push({report_id:id,zone_id:scenario.zoneId!});
  }
  return {baseline:buildDss(source,{},now),simulated:buildDss(changed,{},now),scenario};
}
