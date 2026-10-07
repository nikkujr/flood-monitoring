export const residentQualityConditions = {
  incomplete: "r.record_status='Active' AND (NULLIF(TRIM(r.full_name),'') IS NULL OR r.date_of_birth IS NULL OR NULLIF(TRIM(r.sex),'') IS NULL OR NULLIF(TRIM(r.address_line),'') IS NULL OR r.household_id IS NULL)",
  emergencyContact: "r.record_status='Active' AND (NULLIF(TRIM(r.emergency_contact_name),'') IS NULL OR NULLIF(TRIM(r.emergency_contact_number),'') IS NULL)",
  unassigned: "r.record_status='Active' AND r.evacuation_status IN ('For Evacuation','Evacuated') AND r.evacuation_shelter_id IS NULL"
};
export const reportMissingZone = "status='Validated' AND NOT EXISTS(SELECT 1 FROM flood_report_zones f WHERE f.report_id=flood_reports.report_id)";
export function residentReadiness(r:Record<string,any>,vulnerabilities:string[]) {
  if(r.record_status!=='Active') return {flags:[],needsAssistance:false};
  const flags:string[]=[];
  if(!String(r.emergency_contact_name??'').trim()||!String(r.emergency_contact_number??'').trim()) flags.push('Emergency contact incomplete');
  if(['For Evacuation','Evacuated'].includes(r.evacuation_status)&&!r.evacuation_shelter_id) flags.push('Evacuation center not assigned');
  return {flags,needsAssistance:vulnerabilities.length>0||r.priority_level==='High'||r.can_swim==='No'};
}
