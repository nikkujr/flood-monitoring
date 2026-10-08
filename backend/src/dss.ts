export const riskLevels = ['Low', 'Moderate', 'High', 'Critical'] as const;
export type Risk = typeof riskLevels[number];
export interface DssFilters { zone?: string; risk?: string; from?: string; to?: string; severity?: string; evacuationStatus?: string; vulnerability?: string }
export interface Zone { zone_id: string; zone_name: string }
export interface Household { household_id: string; household_number: string; zone_id: string; address_line: string; head_of_household_name: string }
export interface Resident { resident_id: string; household_id: string; full_name: string; date_of_birth: string | null; address_line: string; vulnerability_type: string | null; vulnerability_other: string | null; pwd_specify: string | null; morbidity: string | null; can_swim: string | null; house_type: string | null; priority_level: string; evacuation_status: string; outcome?:string|null }
export interface Report { report_id: string; tracking_code: string; location_text: string; severity_level: string; status: string; created_at: string; incident_type: string }
export interface Shelter { shelter_id: string; shelter_name: string; zone_id: string; location_text: string; capacity: number; current_occupancy: number | null; status: string }
export interface DssSource { zones: Zone[]; households: Household[]; residents: Resident[]; reports: Report[]; reportZones: {report_id: string; zone_id: string}[]; shelters: Shelter[] }
export const riskRules = [
  'Report-count escalation: 5 or more active validated reports in one zone is Critical; 3 to 4 is High; 1 to 2 is Moderate unless another rule raises the risk.',
  'Critical: a validated major incident, at least two active validated reports, and at least one vulnerable resident in the zone.',
  'High: a validated major incident, or at least two active validated minor incidents, unless the Critical rule applies.',
  'Moderate: at least one active validated report, unless a higher rule applies.',
  'Low: no active validated reports in the selected incident period. This does not establish that the area is safe.',
  'Active means Validated. Submitted and Under Review reports need verification; Resolved and Rejected reports do not raise current risk.',
  'Repeated incidents means at least two Validated or Resolved report records in a zone in the selected period; records may describe the same event.',
  'Vulnerability includes age 60 or above, age under 18, recorded disability, pregnancy, mobility limitation, other recorded vulnerability, or recorded morbidity. Ages are calculated as of today.',
  'Vulnerable residents: Critical → Highest, High → High, Moderate → Medium, Low → Lower. Non-vulnerable residents: Critical → High, High → Medium, otherwise Lower. A manually recorded High priority raises active-zone priority to at least High.',
  'Residents explicitly marked For Evacuation stay in the assistance queue until recorded as Evacuated, including residents in Low-risk zones.',
  'Risk uses the complete registered zone population. Vulnerability and evacuation-status filters narrow population counts and lists, not the underlying zone risk.',
  'Shelter availability is capacity minus occupancy for operational centers. Full or Unavailable centers contribute no available spaces; missing occupancy is unknown. Nearly Full means at least 90% occupied or a recorded Near Capacity status.'
];
const responses: Record<Risk,string> = {
  Low: 'Continue monitoring flood reports and verify pending reports.',
  Moderate: 'Increase monitoring and prepare evacuation resources.',
  High: 'Prepare evacuation operations and prioritize vulnerable residents in affected zones.',
  Critical: 'Prioritize immediate evacuation assistance for vulnerable residents in affected zones and coordinate available evacuation resources.'
};
const present = (value: string | null | undefined) => !!value?.trim() && !['n','no','none','n/a','na','not applicable','not recorded','-','0'].includes(value.trim().toLowerCase());
export function vulnerabilities(resident: Resident, today: string): string[] {
  const labels = new Set<string>();
  const birth = resident.date_of_birth?.slice(0,10);
  if (birth && /^\d{4}-\d{2}-\d{2}$/.test(birth) && birth <= today) {
    const age = Number(today.slice(0,4))-Number(birth.slice(0,4))-(today.slice(5)<birth.slice(5)?1:0);
    if (age >= 60) labels.add('Senior citizen');
    if (age < 18) labels.add('Child');
  }
  const type = resident.vulnerability_type?.trim();
  if (present(type)) labels.add(({Elderly:'Senior citizen',Disability:'PWD',Pregnant:'Pregnant',Child:'Child'} as Record<string,string>)[type!] ?? type!);
  if (present(resident.pwd_specify)) labels.add('PWD');
  if (present(resident.morbidity)) labels.add('Morbidity');
  return [...labels];
}
export function assessRisk(reports: Report[], vulnerable: number): {risk: Risk; rule: string} {
  const active = reports.filter(r=>r.status==='Validated');
  const major = active.some(r=>r.severity_level==='Major Incident');
  if (active.length >= 5) return {risk:'Critical',rule:'At least 5 active validated reports in this zone.'};
  if (major && active.length >= 2 && vulnerable > 0) return {risk:'Critical',rule:'A validated major incident, at least 2 active validated reports, and registered vulnerable residents in this zone.'};
  if (active.length >= 3) return {risk:'High',rule:'At least 3 active validated reports in this zone.'};
  if (major) return {risk:'High',rule:'At least 1 active validated major incident in this zone.'};
  if (active.filter(r=>r.severity_level==='Minor Incident').length >= 2) return {risk:'High',rule:'At least 2 active validated minor incidents in this zone.'};
  return active.length ? {risk:'Moderate',rule:'At least 1 active validated report; no higher risk rule matched.'}
    : {risk:'Low',rule:'No active validated reports in this selection. This does not establish that the zone is safe.'};
}
const priorityOrder = ['Highest','High','Medium','Lower'];
export function priorityFor(risk: Risk, vulnerable: boolean, manual: string) {
  let priority = vulnerable ? ({Critical:'Highest',High:'High',Moderate:'Medium',Low:'Lower'} as const)[risk]
    : ({Critical:'High',High:'Medium',Moderate:'Lower',Low:'Lower'} as const)[risk];
  if (risk !== 'Low' && manual === 'High' && priorityOrder.indexOf(priority)>1) priority='High';
  return priority;
}
export function buildDss(source: DssSource, filters: DssFilters = {}, now = new Date()) {
  const today = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
  const households = new Map(source.households.map(h=>[h.household_id,h]));
  const zonesById = new Map(source.zones.map(z=>[z.zone_id,z]));
  const links = new Map<string,Set<string>>();
  for (const link of source.reportZones) {
    if (!zonesById.has(link.zone_id)) continue;
    if (!links.has(link.report_id)) links.set(link.report_id,new Set());
    links.get(link.report_id)!.add(link.zone_id);
  }
  const reports = source.reports.filter(r=>(!filters.from || r.created_at.slice(0,10)>=filters.from)
    && (!filters.to || r.created_at.slice(0,10)<=filters.to) && (!filters.severity || r.severity_level===filters.severity));
  const people = source.residents.filter(r=>r.outcome!=='Deceased').map(r=>({...r,vulnerabilities:vulnerabilities(r,today),household:households.get(r.household_id)}));
  const populationMatches = (r: typeof people[number]) => (!filters.evacuationStatus || r.evacuation_status===filters.evacuationStatus)
    && (!filters.vulnerability || (filters.vulnerability==='Any' ? r.vulnerabilities.length>0 : filters.vulnerability==='Other' ? r.vulnerabilities.some(v=>!['Senior citizen','Child','PWD','Pregnant','Morbidity'].includes(v)) : r.vulnerabilities.includes(filters.vulnerability)));
  const zoneRows = source.zones.filter(z=>!filters.zone || z.zone_id===filters.zone).map(zone=>{
    const zoneReports = reports.filter(r=>links.get(r.report_id)?.has(zone.zone_id));
    const allPeople = people.filter(r=>r.household?.zone_id===zone.zone_id);
    const selectedPeople = allPeople.filter(populationMatches);
    const zoneHouseholds = source.households.filter(h=>h.zone_id===zone.zone_id && (!(filters.vulnerability || filters.evacuationStatus) || selectedPeople.some(r=>r.household_id===h.household_id)));
    const active = zoneReports.filter(r=>r.status==='Validated');
    const {risk,rule} = assessRisk(zoneReports,allPeople.filter(r=>r.vulnerabilities.length).length);
    const repeated = zoneReports.filter(r=>['Validated','Resolved'].includes(r.status)).length;
    return {id:zone.zone_id,name:zone.zone_name,risk,rule,evidence:active.map(r=>({id:r.report_id,code:r.tracking_code,severity:r.severity_level,createdAt:r.created_at})),activeReports:active.length,totalReports:zoneReports.length,repeatReports:repeated,
      residents:selectedPeople.length,households:zoneHouseholds.length,vulnerableResidents:selectedPeople.filter(r=>r.vulnerabilities.length).length,
      affectedResidents:active.length?selectedPeople.length:0,affectedHouseholds:active.length?zoneHouseholds.length:0,
      affectedVulnerable:active.length?selectedPeople.filter(r=>r.vulnerabilities.length).length:0,
      populationKnown:allPeople.length>0,householdsKnown:source.households.some(h=>h.zone_id===zone.zone_id),
      explanation:`${active.length} active validated report(s), ${active.filter(r=>r.severity_level==='Major Incident').length} major, ${active.filter(r=>r.severity_level==='Minor Incident').length} minor; ${allPeople.filter(r=>r.vulnerabilities.length).length} registered vulnerable resident(s).`,response:responses[risk]};
  }).filter(z=>!filters.risk || z.risk===filters.risk).sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true}));
  const selectedZones = new Map(zoneRows.map(z=>[z.id,z]));
  const selectedReports = reports.filter(r=>{
    const ids = links.get(r.report_id);
    return ids?.size ? [...ids].some(id=>selectedZones.has(id)) : !filters.zone && !filters.risk;
  });
  const selectedPeople = people.filter(r=>r.household && selectedZones.has(r.household.zone_id) && populationMatches(r));
  const priorities = selectedPeople.map(r=>{
    const zone = selectedZones.get(r.household!.zone_id)!;
    const priority = priorityFor(zone.risk,r.vulnerabilities.length>0,r.priority_level);
    return {id:r.resident_id,name:r.full_name,householdId:r.household_id,household:r.household!.household_number,zoneId:zone.id,zone:zone.name,address:r.address_line || r.household!.address_line,
      vulnerabilities:r.vulnerabilities,details:[present(r.pwd_specify)?r.pwd_specify:null,present(r.morbidity)?r.morbidity:null,present(r.vulnerability_other)?r.vulnerability_other:null].filter(Boolean),
      risk:zone.risk,priority,status:r.evacuation_status,outcome:r.outcome??null,manualPriority:r.priority_level,
      assistance:[r.can_swim==='No'?'Cannot swim':null,r.house_type==='Light materials'?'House: light materials':null].filter(Boolean)};
  }).sort((a,b)=>priorityOrder.indexOf(a.priority)-priorityOrder.indexOf(b.priority) || riskLevels.indexOf(b.risk)-riskLevels.indexOf(a.risk) || a.name.localeCompare(b.name));
  const evacuation = priorities.filter(r=>r.outcome!=='Missing' && (r.priority!=='Lower' || r.status==='For Evacuation') && r.status!=='Evacuated');
  const priorityHouseholds = [...new Set(evacuation.map(r=>r.householdId))].map(id=>{
    const members = evacuation.filter(r=>r.householdId===id);
    const first = members[0]!;
    return {id,number:first.household,zone:first.zone,priority:first.priority,risk:first.risk,residents:members.length,vulnerabilities:[...new Set(members.flatMap(r=>r.vulnerabilities))],statuses:[...new Set(members.map(r=>r.status))]};
  });
  const shelters = source.shelters.filter(s=>selectedZones.has(s.zone_id)).map(s=>{
    const occupancy = s.current_occupancy;
    const available = ['Unavailable','Full'].includes(s.status)?0:occupancy===null?null:Math.max(0,s.capacity-occupancy);
    const status = s.status==='Unavailable'?'Unavailable':s.status==='Full' || (occupancy!==null && occupancy>=s.capacity)?'Full':occupancy===null?'Unknown':s.status==='Near Capacity' || occupancy>=s.capacity*.9?'Nearly Full':'Available';
    return {id:s.shelter_id,name:s.shelter_name,zoneId:s.zone_id,zone:selectedZones.get(s.zone_id)!.name,location:s.location_text,capacity:s.capacity,occupancy,available,status};
  });
  const recommendations = zoneRows.map(z=>({zone:z.name,risk:z.risk,text:z.response,reason:z.explanation}));
  const alerts = zoneRows.filter(z=>z.activeReports>=3).map(z=>({
    zoneId:z.id,zone:z.name,risk:z.risk,activeReports:z.activeReports,
    message:`${z.name} has ${z.activeReports} active validated flood reports and is assessed ${z.risk}. ${z.rule}`
  }));
  for (const zone of zoneRows.filter(z=>z.activeReports)) {
    const centers = shelters.filter(s=>s.zoneId===zone.id);
    const demand = evacuation.filter(r=>r.zoneId===zone.id).length;
    const available = centers.reduce((n,s)=>n+(s.available??0),0);
    if (!centers.length) recommendations.push({zone:zone.name,risk:zone.risk,text:'No evacuation center data available for this zone. Coordinate shelter availability with neighboring zones.',reason:`${demand} selected residents need priority assistance.`});
    else if (demand>available) recommendations.push({zone:zone.name,risk:zone.risk,text:`Coordinate additional shelter space or transport: ${demand} priority residents versus ${available} known available spaces in this zone.`,reason:'This compares selected priority residents who are not recorded as evacuated with local operational capacity; it is a planning estimate.'});
    if (centers.some(s=>s.available===null)) recommendations.push({zone:zone.name,risk:zone.risk,text:'Confirm missing shelter occupancy before allocating residents.',reason:'Available capacity cannot be calculated for every center.'});
  }
  const pending = selectedReports.filter(r=>['Submitted','Under Review'].includes(r.status)).length;
  const unmapped = selectedReports.filter(r=>r.status==='Validated' && !links.get(r.report_id)?.size).length;
  const overallRisk = zoneRows.length ? zoneRows.reduce<Risk>((risk,z)=>riskLevels.indexOf(z.risk)>riskLevels.indexOf(risk)?z.risk:risk,'Low') : null;
  const activeCount = selectedReports.filter(r=>r.status==='Validated').length;
  const incidentRecords = [...selectedReports].sort((a,b)=>b.created_at.localeCompare(a.created_at)).map(r=>({id:r.report_id,code:r.tracking_code,location:r.location_text,severity:r.severity_level,status:r.status,createdAt:r.created_at,zones:[...(links.get(r.report_id)??[])].map(id=>zonesById.get(id)!.zone_name)}));
  if (pending) recommendations.push({zone:'Selected reports',risk:overallRisk??'Low',text:`Validate ${pending} pending report(s) before using them to raise assessed risk.`,reason:'Submitted and Under Review reports are unverified.'});
  if (unmapped) recommendations.push({zone:'Unassigned reports',risk:overallRisk??'Low',text:`Assign affected zones to ${unmapped} active validated report(s).`,reason:'These reports cannot contribute to zone risk or resident exposure until zones are linked.'});
  return {generatedAt:now.toISOString(),filters,zoneOptions:source.zones.map(z=>({id:z.zone_id,name:z.zone_name})),rules:riskRules,
    overall:{risk:overallRisk,explanation:overallRisk?`${overallRisk} is the highest assessed zone risk in this selection. ${activeCount} active validated report(s) across ${zoneRows.filter(z=>z.activeReports).length} linked zone(s).${unmapped?' Assessment is incomplete: some active reports have no zone.':''}`:'No data available for the selected zones.'},
    metrics:{residents:selectedPeople.length,households:zoneRows.reduce((n,z)=>n+z.households,0),vulnerableResidents:selectedPeople.filter(r=>r.vulnerabilities.length).length,activeReports:activeCount,affectedZones:zoneRows.filter(z=>z.activeReports).length,highRiskZones:zoneRows.filter(z=>['High','Critical'].includes(z.risk)).length,priorityResidents:evacuation.length,affectedVulnerable:zoneRows.reduce((n,z)=>n+z.affectedVulnerable,0)},
    zones:zoneRows,incidents:{total:selectedReports.length,active:activeCount,resolved:selectedReports.filter(r=>r.status==='Resolved').length,pending,rejected:selectedReports.filter(r=>r.status==='Rejected').length,unassignedActive:unmapped,
      bySeverity:['Information','Minor Incident','Major Incident'].map(severity=>({severity,count:selectedReports.filter(r=>r.severity_level===severity).length})),
      recent:incidentRecords.slice(0,10),activeRecords:incidentRecords.filter(r=>r.status==='Validated')},
    vulnerable:priorities.filter(r=>r.vulnerabilities.length),evacuation,priorityHouseholds,shelters,recommendations,alerts,
    coverage:{zones:zoneRows.length,registeredPopulationKnown:zoneRows.some(z=>z.populationKnown),missingPopulationZones:zoneRows.filter(z=>!z.populationKnown).map(z=>z.name),unassignedActive:unmapped},
    scope:'Risk is a rule-based assessment of validated reports in the selected date/severity scope, not a flood forecast. Exposure is zone-wide potential exposure, not confirmed affected individuals. Date filters use report creation dates; resident and shelter data are current. Resident filters narrow counts and priority lists; shelter capacity remains physical capacity in selected zones.'};
}
