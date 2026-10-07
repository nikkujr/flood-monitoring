import type { DssData, DssPerson } from './dss.models';

export function buildEvacuationPlan(data:DssData, allowOtherZones=true) {
  // ponytail: greedy placement may split families a global optimizer could keep together; add optimization when operational reviews justify it.
  const order=['Highest','High','Medium','Lower'];
  const people=[...data.evacuation].filter(p=>p.status!=='Evacuated').sort((a,b)=>order.indexOf(a.priority)-order.indexOf(b.priority)
    || Number(b.status==='For Evacuation')-Number(a.status==='For Evacuation') || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const centers=data.shelters.filter(s=>!['Full','Unavailable','Unknown'].includes(s.status) && s.available!==null && s.available>0)
    .sort((a,b)=>a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const remaining=new Map(centers.map(s=>[s.id,Math.floor(s.available!)]));
  const families=new Map<string,DssPerson[]>();
  for (const person of people) families.set(person.householdId,[...(families.get(person.householdId)??[]),person]);
  const assignments:Array<{person:DssPerson;shelter:DssData['shelters'][number]|null;crossZone:boolean;splitHousehold:boolean}>=[];
  for (const family of families.values()) {
    const candidates=centers.filter(s=>allowOtherZones || s.zoneId===family[0]!.zoneId)
      .sort((a,b)=>Number(b.zoneId===family[0]!.zoneId)-Number(a.zoneId===family[0]!.zoneId)
        || (remaining.get(b.id)!-remaining.get(a.id)!) || a.name.localeCompare(b.name));
    const together=candidates.find(s=>remaining.get(s.id)!>=family.length);
    const familyAssignments=family.map(person=>{
      const shelter=together??candidates.find(s=>remaining.get(s.id)!>0)??null;
      if (shelter) remaining.set(shelter.id,remaining.get(shelter.id)!-1);
      return {person,shelter,crossZone:!!shelter && shelter.zoneId!==person.zoneId,splitHousehold:false};
    });
    const split=new Set(familyAssignments.map(a=>a.shelter?.id??'unplaced')).size>1;
    for (const assignment of familyAssignments) assignment.splitHousehold=split;
    assignments.push(...familyAssignments);
  }
  return {assignments,remaining,availableSpaces:centers.reduce((n,s)=>n+Math.floor(s.available!),0),
    suggested:assignments.filter(a=>a.shelter).length,unplaced:assignments.filter(a=>!a.shelter).length,
    splitHouseholds:new Set(assignments.filter(a=>a.splitHousehold).map(a=>a.person.householdId)).size};
}
