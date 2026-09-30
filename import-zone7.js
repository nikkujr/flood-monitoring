const { randomUUID } = require('crypto');
const path = require('path');
const XLSX = require('xlsx');
const mysql = require('./backend/node_modules/mysql2/promise');
const dotenv = require('./backend/node_modules/dotenv');

const workbookPath = 'C:/Users/Admin/Downloads/Residents File/ZONE 7.xlsx';
const apply = process.argv.includes('--apply');
const envArgument = process.argv.find((argument) => argument.startsWith('--env='));
const envPath = envArgument
  ? path.resolve(envArgument.slice('--env='.length))
  : path.resolve(__dirname, 'deploy/smarterasp/.env');

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

function excelDate(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return null;
    return `${String(parsed.y).padStart(4, '0')}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
  }
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return value.toISOString().slice(0, 10);
  const text = clean(value);
  if (!text) return null;
  const parsed = new Date(text);
  return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString().slice(0, 10);
}

function readHouseholds() {
  const workbook = XLSX.readFile(workbookPath, { cellDates: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true, blankrows: false });
  const households = [];
  let current = null;
  let defaultedBirthDates = 0;

  for (const row of rows.slice(4)) {
    const householdCell = clean(row[0]);
    const memberName = clean(row[1]);
    if (/^\d+$/.test(householdCell)) {
      current = {
        sourceNumber: Number(householdCell),
        householdNumber: `Z7-${Number(householdCell)}`,
        address: 'Zone 7, Barangay Colacling',
        headName: null,
        members: []
      };
      households.push(current);
    }
    if (!memberName) continue;
    if (!current) throw new Error(`Resident row found before the first household: ${memberName}`);

    const relationship = clean(row[5]).toUpperCase();
    if ((relationship === 'HH' || relationship === 'HEAD') && !current.headName) current.headName = memberName;
    const birthDate = excelDate(row[6]);
    if (!birthDate) defaultedBirthDates += 1;
    const sexCode = clean(row[4]).toUpperCase();
    const pwd = normalizedFlag(row[17]);
    const soloParent = normalizedFlag(row[18]);

    current.members.push({
      fullName: memberName,
      relationship: relationship || null,
      birthDate: birthDate || '2000-01-01',
      sex: sexCode === 'M' ? 'Male' : sexCode === 'F' ? 'Female' : 'Prefer not to say',
      maritalStatus: nullable(row[8]),
      outOfSchoolYouth: normalizedFlag(row[9]),
      occupation: nullable(row[11]) || nullable(row[10]),
      education: nullable(row[12]),
      philsysNumber: nullable(row[13]),
      philhealthNumber: nullable(row[14]),
      fpUse: normalizedFlag(row[15]),
      unmetNeeds: normalizedFlag(row[16]),
      pwdSpecify: pwd,
      soloParent,
      morbidity: normalizedFlag(row[19]),
      waterSourceLevel: nullable(row[20]),
      sanitaryToilet: nullable(row[21]),
      vulnerabilityType: pwd && !['NO', 'N'].includes(pwd) ? 'Person with Disability' : soloParent === 'YES' ? 'Solo Parent' : null
    });
  }

  const householdNumbers = new Set(households.map((household) => household.householdNumber));
  if (householdNumbers.size !== households.length) throw new Error('Duplicate household numbers were found in the workbook.');
  if (households.some((household) => household.members.length === 0)) throw new Error('A household without residents was found in the workbook.');
  for (const household of households) household.headName ||= household.members[0].fullName;
  return { households, defaultedBirthDates };
}

function connectionOptions(databaseUrl) {
  const url = new URL(databaseUrl);
  return {
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.replace(/^\//, '')),
    charset: 'utf8mb4'
  };
}

(async () => {
  if (!process.env.DATABASE_URL) throw new Error(`DATABASE_URL is missing from ${envPath}`);
  const { households, defaultedBirthDates } = readHouseholds();
  const residentCount = households.reduce((total, household) => total + household.members.length, 0);
  const connection = await mysql.createConnection(connectionOptions(process.env.DATABASE_URL));

  try {
    const [zoneRows] = await connection.query('SELECT zone_id, zone_name FROM zones ORDER BY zone_name');
    const matches = zoneRows.filter((row) => /(?:^|\D)7(?:\D|$)/.test(row.zone_name) && /zone/i.test(row.zone_name));
    if (matches.length !== 1) {
      throw new Error(`Expected exactly one Zone 7 database record, found ${matches.length}. Available zones: ${zoneRows.map((row) => row.zone_name).join(', ')}`);
    }
    const zone = matches[0];
    const [[existing]] = await connection.query(
      `SELECT COUNT(DISTINCT h.household_id) household_count, COUNT(r.resident_id) resident_count
       FROM households h LEFT JOIN residents r ON r.household_id=h.household_id WHERE h.zone_id=?`,
      [zone.zone_id]
    );

    console.log(JSON.stringify({
      mode: apply ? 'apply' : 'dry-run',
      databaseHost: connection.config.host,
      databaseName: connection.config.database,
      zone: zone.zone_name,
      workbookHouseholds: households.length,
      workbookResidents: residentCount,
      missingBirthDatesDefaulted: defaultedBirthDates,
      existingHouseholds: Number(existing.household_count),
      existingResidents: Number(existing.resident_count)
    }, null, 2));
    if (!apply) return;

    await connection.beginTransaction();
    try {
      for (const household of households) {
        const [existingHouseholds] = await connection.query(
          'SELECT household_id FROM households WHERE household_number=? LIMIT 1',
          [household.householdNumber]
        );
        const householdId = existingHouseholds[0]?.household_id || randomUUID();
        await connection.execute(
          `INSERT INTO households (household_id, household_number, zone_id, address_line, head_of_household_name, contact_number, verification_status)
           VALUES (?, ?, ?, ?, ?, NULL, 'Verified')
           ON DUPLICATE KEY UPDATE zone_id=VALUES(zone_id), address_line=VALUES(address_line),
             head_of_household_name=VALUES(head_of_household_name), verification_status='Verified'`,
          [householdId, household.householdNumber, zone.zone_id, household.address, household.headName]
        );
        await connection.execute('DELETE FROM residents WHERE household_id=?', [householdId]);

        for (const member of household.members) {
          await connection.execute(
            `INSERT INTO residents (
              resident_id, household_id, full_name, date_of_birth, sex, contact_number, address_line,
              vulnerability_type, relationship_to_head, marital_status, out_of_school_youth, occupation,
              education, philsys_number, philhealth_number, fp_use, unmet_needs, pwd_specify,
              solo_parent, morbidity, water_source_level, sanitary_toilet, priority_level, evacuation_status
            ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Low', 'Safe')`,
            [
              randomUUID(), householdId, member.fullName, member.birthDate, member.sex, household.address,
              member.vulnerabilityType, member.relationship, member.maritalStatus, member.outOfSchoolYouth,
              member.occupation, member.education, member.philsysNumber, member.philhealthNumber,
              member.fpUse, member.unmetNeeds, member.pwdSpecify, member.soloParent, member.morbidity,
              member.waterSourceLevel, member.sanitaryToilet
            ]
          );
        }
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    }

    const [[verified]] = await connection.query(
      `SELECT COUNT(DISTINCT h.household_id) household_count, COUNT(r.resident_id) resident_count
       FROM households h LEFT JOIN residents r ON r.household_id=h.household_id WHERE h.zone_id=?`,
      [zone.zone_id]
    );
    console.log(`Imported and verified ${verified.household_count} Zone 7 households and ${verified.resident_count} residents.`);
  } finally {
    await connection.end();
  }
})().catch((error) => {
  console.error('Zone 7 import failed:', error.message || error);
  process.exitCode = 1;
});
