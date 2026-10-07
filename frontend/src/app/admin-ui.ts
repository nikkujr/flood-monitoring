export function shortRecordId(id: string) {
  return /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id) ? id.slice(0, 8).toUpperCase() : id;
}

export function searchResidents<T extends { name: string; household: string }>(residents: T[], query: string) {
  const search = query.trim().toLowerCase();
  return residents.filter(resident => resident.name.toLowerCase().includes(search) || resident.household.toLowerCase().includes(search));
}

export function dashboardCount(value: unknown): number | '—' {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return '—';
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 0 ? count : '—';
}

export function residentFieldSections<T extends { name: string }>(fields: T[]) {
  const groups = [
    { title: 'Personal information', names: ['fullName', 'dateOfBirth', 'age', 'sex', 'maritalStatus', 'contactNumber'] },
    { title: 'Background and identification', names: ['occupation', 'education', 'outOfSchoolYouth', 'philsysNumber', 'philhealthNumber'] },
    { title: 'Household and living conditions', names: ['householdId', 'addressLine', 'relationshipToHead', 'houseType', 'waterSourceLevel', 'sanitaryToilet'] },
    { title: 'Health and assistance', names: ['vulnerabilityType', 'pwdSpecify', 'morbidity', 'soloParent', 'fpUse', 'unmetNeeds', 'canSwim'] },
    { title: 'Emergency contact', names: ['emergencyContactName', 'emergencyContactNumber'] },
    { title: 'Priority and evacuation', names: ['priorityLevel', 'recordStatus', 'evacuationStatus', 'evacuationShelterId'] }
  ];
  const sections = groups.map(group => ({ title: group.title, fields: fields.filter(field => group.names.includes(field.name)) }));
  const assigned = new Set(groups.flatMap(group => group.names));
  const remaining = fields.filter(field => !assigned.has(field.name));
  if (remaining.length) sections.push({ title: 'Other information', fields: remaining });
  return sections.filter(section => section.fields.length);
}

export function editorFieldSections<T extends { name: string }>(resource: string, fields: T[]) {
  if (resource === 'residents' && fields.length > 8) return residentFieldSections(fields);
  if (resource === 'shelters' && fields.length > 8) return [
    { title: 'Center and location', fields: fields.slice(0, 4) },
    { title: 'Capacity and contacts', fields: fields.slice(4, 8) },
    { title: 'Availability', fields: fields.slice(8) }
  ];
  return [{ title: '', fields }];
}
