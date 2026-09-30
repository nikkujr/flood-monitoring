const { randomUUID } = require('crypto');
const path = require('path');
const XLSX = require('xlsx');
const mysql = require('./backend/node_modules/mysql2/promise');
const dotenv = require('./backend/node_modules/dotenv');

const apply = process.argv.includes('--apply');
const envArgument = process.argv.find((argument) => argument.startsWith('--env='));
const envPath = envArgument ? path.resolve(envArgument.slice(6)) : path.resolve(__dirname, 'backend/.env');
dotenv.config({ path: envPath, override: true, quiet: true });

const clean = (value) => value === null || value === undefined ? '' : String(value).trim();
const nullable = (value) => clean(value) || null;
const normalizedFlag = (value) => {
  const text = clean(value).toUpperCase();
  if (!text) return null;
  if (text === 'Y') return 'YES';
  if (text === 'N') return 'NO';
  return text;
};
const isPropertyLabel = (value) => /VACANT HOUSE|RENTAL HOUSE|FOR CAF[EÉ]/i.test(clean(value));

function excelDate(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return null;
    return `${String(parsed.y).padStart(4, '0')}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
  }
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return value.toISOString().slice(0, 10);
  const text = clean(value);
  if (!text) return null;
  const match = text.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (!match) return null;
  const parsed = new Date(Date.UTC(Number(match[3]), Number(match[1]) - 1, Number(match[2])));
  return parsed.getUTCFullYear() === Number(match[3]) && parsed.getUTCMonth() + 1 === Number(match[1]) && parsed.getUTCDate() === Number(match[2])
    ? parsed.toISOString().slice(0, 10) : null;
}

function splitBirthDate(monthDayValue, yearValue) {
  const year = Number(clean(yearValue));
  if (!Number.isInteger(year) || year < 1900 || year > new Date().getFullYear()) return null;
  if (typeof monthDayValue !== 'number' || !Number.isFinite(monthDayValue)) return null;
  const parsed = XLSX.SSF.parse_date_code(monthDayValue);
  if (!parsed) return null;
  const result = `${String(year).padStart(4, '0')}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
  const check = new Date(`${result}T00:00:00Z`);
  return check.getUTCFullYear() === year && check.getUTCMonth() + 1 === parsed.m && check.getUTCDate() === parsed.d ? result : null;
}

function member(fields) {
  const pwd = normalizedFlag(fields.pwd);
  const soloParent = normalizedFlag(fields.soloParent);
  const birthDateDefaulted = !fields.birthDate;
  return {
    fullName: clean(fields.fullName),
    relationship: nullable(fields.relationship)?.toUpperCase() || null,
    birthDate: fields.birthDate || '2000-01-01',
    birthDateDefaulted,
    sex: clean(fields.sex).toUpperCase() === 'M' ? 'Male' : clean(fields.sex).toUpperCase() === 'F' ? 'Female' : 'Prefer not to say',
    maritalStatus: nullable(fields.maritalStatus),
    outOfSchoolYouth: normalizedFlag(fields.outOfSchoolYouth),
    occupation: nullable(fields.occupation),
    education: nullable(fields.education),
    philsysNumber: nullable(fields.philsysNumber),
    philhealthNumber: nullable(fields.philhealthNumber),
    fpUse: normalizedFlag(fields.fpUse),
    unmetNeeds: normalizedFlag(fields.unmetNeeds),
    pwdSpecify: pwd,
    soloParent,
    morbidity: nullable(fields.morbidity),
    waterSourceLevel: nullable(fields.waterSourceLevel),
    sanitaryToilet: nullable(fields.sanitaryToilet),
    vulnerabilityType: pwd && !['NO', 'N'].includes(pwd) ? 'Person with Disability' : soloParent === 'YES' ? 'Solo Parent' : null
  };
}

function readZone3() {
  const workbook = XLSX.readFile('C:/Users/Admin/Downloads/Residents File/ZONE 3.xlsx', { cellDates: false });
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1, defval: null, raw: true, blankrows: false });
  return readRows(3, rows.slice(4), (row) => {
    const fullName = [row[1], row[2], row[3]].map(clean).find(Boolean) || '';
    return member({
      fullName, sex: row[4], relationship: row[5], birthDate: excelDate(row[6]), maritalStatus: row[8],
      outOfSchoolYouth: row[9], occupation: row[11], education: row[12], philsysNumber: row[13],
      philhealthNumber: row[14], fpUse: row[15], unmetNeeds: row[16], pwd: row[17], soloParent: row[18],
      morbidity: row[19], waterSourceLevel: row[20], sanitaryToilet: row[21]
    });
  });
}

function readZone4() {
  const workbook = XLSX.readFile('C:/Users/Admin/Downloads/Residents File/ZONE 4.xlsx', { cellDates: false });
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1, defval: null, raw: true, blankrows: false });
  return readRows(4, rows.slice(5), (row) => member({
    fullName: row[2], sex: row[3], relationship: row[4], birthDate: splitBirthDate(row[5], row[6]),
    maritalStatus: row[8], outOfSchoolYouth: row[9], occupation: row[10], education: row[11],
    philsysNumber: row[12], philhealthNumber: row[13], fpUse: row[14], unmetNeeds: row[15], pwd: row[16],
    soloParent: row[17], morbidity: row[18], waterSourceLevel: row[19], sanitaryToilet: row[20]
  }));
}

function readRows(zoneNumber, rows, parseMember) {
  const households = [];
  let current = null;
  let defaultedBirthDates = 0;
  let excludedPropertyRows = 0;
  for (const row of rows) {
    const householdCell = clean(row[0]);
    const parsed = parseMember(row);
    if (/^\d+$/.test(householdCell)) {
      if (!parsed.fullName || isPropertyLabel(parsed.fullName)) {
        current = null;
      } else {
        current = {
          householdNumber: `Z${zoneNumber}-${Number(householdCell)}`,
          address: `Zone ${zoneNumber}, Barangay Colacling`,
          headName: null,
          members: []
        };
        households.push(current);
      }
    }
    if (!parsed.fullName) continue;
    if (isPropertyLabel(parsed.fullName)) {
      excludedPropertyRows += 1;
      continue;
    }
    if (!current) throw new Error(`Zone ${zoneNumber}: resident row found before a household: ${parsed.fullName}`);
    if (parsed.birthDateDefaulted) defaultedBirthDates += 1;
    if (['HH', 'HEAD'].includes(parsed.relationship) && !current.headName) current.headName = parsed.fullName;
    current.members.push(parsed);
  }
  const numbers = new Set(households.map((household) => household.householdNumber));
  if (numbers.size !== households.length) throw new Error(`Zone ${zoneNumber}: duplicate household numbers remain after excluding property-only rows.`);
  if (households.some((household) => household.members.length === 0)) throw new Error(`Zone ${zoneNumber}: a household without residents was found.`);
  for (const household of households) household.headName ||= household.members[0].fullName;
  return { zoneNumber, households, defaultedBirthDates, excludedPropertyRows };
}

function connectionOptions(databaseUrl) {
  const url = new URL(databaseUrl);
  return {
    host: url.hostname, port: Number(url.port || 3306), user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password), database: decodeURIComponent(url.pathname.replace(/^\//, '')), charset: 'utf8mb4'
  };
}

async function importZone(connection, source) {
  const { zoneNumber, households, defaultedBirthDates, excludedPropertyRows } = source;
  const [zoneRows] = await connection.query('SELECT zone_id, zone_name FROM zones ORDER BY zone_name');
  const matches = zoneRows.filter((row) => clean(row.zone_name).toLowerCase() === `zone ${zoneNumber}`);
  if (matches.length !== 1) throw new Error(`Expected exactly one Zone ${zoneNumber} record, found ${matches.length}.`);
  const zone = matches[0];
  const [[existing]] = await connection.query(
    `SELECT COUNT(DISTINCT h.household_id) household_count, COUNT(r.resident_id) resident_count
     FROM households h LEFT JOIN residents r ON r.household_id=h.household_id WHERE h.zone_id=?`, [zone.zone_id]
  );
  const residentCount = households.reduce((total, household) => total + household.members.length, 0);
  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'dry-run', zone: zone.zone_name, workbookHouseholds: households.length,
    workbookResidents: residentCount, missingBirthDatesDefaulted: defaultedBirthDates,
    excludedPropertyRows, existingHouseholds: Number(existing.household_count), existingResidents: Number(existing.resident_count)
  }, null, 2));
  if (!apply) return;

  for (const household of households) {
    const [found] = await connection.query('SELECT household_id FROM households WHERE household_number=? LIMIT 1', [household.householdNumber]);
    const householdId = found[0]?.household_id || randomUUID();
    await connection.execute(
      `INSERT INTO households (household_id, household_number, zone_id, address_line, head_of_household_name, contact_number, verification_status)
       VALUES (?, ?, ?, ?, ?, NULL, 'Verified') ON DUPLICATE KEY UPDATE zone_id=VALUES(zone_id),
       address_line=VALUES(address_line), head_of_household_name=VALUES(head_of_household_name), verification_status='Verified'`,
      [householdId, household.householdNumber, zone.zone_id, household.address, household.headName]
    );
    await connection.execute('DELETE FROM residents WHERE household_id=?', [householdId]);
    for (const person of household.members) {
      await connection.execute(
        `INSERT INTO residents (resident_id, household_id, full_name, date_of_birth, sex, contact_number, address_line,
         vulnerability_type, relationship_to_head, marital_status, out_of_school_youth, occupation, education,
         philsys_number, philhealth_number, fp_use, unmet_needs, pwd_specify, solo_parent, morbidity,
         water_source_level, sanitary_toilet, priority_level, evacuation_status)
         VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Low', 'Safe')`,
        [randomUUID(), householdId, person.fullName, person.birthDate, person.sex, household.address,
          person.vulnerabilityType, person.relationship, person.maritalStatus, person.outOfSchoolYouth, person.occupation,
          person.education, person.philsysNumber, person.philhealthNumber, person.fpUse, person.unmetNeeds,
          person.pwdSpecify, person.soloParent, person.morbidity, person.waterSourceLevel, person.sanitaryToilet]
      );
    }
  }
}

(async () => {
  if (!process.env.DATABASE_URL) throw new Error(`DATABASE_URL is missing from ${envPath}`);
  const sources = [readZone3(), readZone4()];
  const connection = await mysql.createConnection(connectionOptions(process.env.DATABASE_URL));
  try {
    if (apply) await connection.beginTransaction();
    try {
      for (const source of sources) await importZone(connection, source);
      if (apply) await connection.commit();
    } catch (error) {
      if (apply) await connection.rollback();
      throw error;
    }
  } finally {
    await connection.end();
  }
})().catch((error) => {
  console.error('Zone 3/4 import failed:', error.message || error);
  process.exitCode = 1;
});
