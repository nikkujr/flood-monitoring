const { randomUUID } = require('crypto');
const path = require('path');
const XLSX = require('xlsx');
const mysql = require('./backend/node_modules/mysql2/promise');
const dotenv = require('./backend/node_modules/dotenv');

const workbookPath = 'C:/Users/Admin/Downloads/Residents File/ZONE 6.xlsx';
const apply = process.argv.includes('--apply');
const envArgument = process.argv.find((argument) => argument.startsWith('--env='));
const envPath = envArgument
  ? path.resolve(envArgument.slice('--env='.length))
  : path.resolve(__dirname, 'backend/.env');

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

function birthDate(monthDayValue, yearValue) {
  const year = Number(clean(yearValue));
  if (!Number.isInteger(year) || year < 1900 || year > new Date().getFullYear()) return null;

  let month;
  let day;
  if (typeof monthDayValue === 'number' && Number.isFinite(monthDayValue)) {
    const parsed = XLSX.SSF.parse_date_code(monthDayValue);
    if (parsed) ({ m: month, d: day } = parsed);
  } else {
    const text = clean(monthDayValue);
    const match = text.match(/^(\d{1,2})[-/]([A-Za-z]{3,9}|\d{1,2})$/);
    if (match) {
      day = Number(match[1]);
      const monthText = match[2].slice(0, 3).toLowerCase();
      const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
      month = /^\d+$/.test(match[2]) ? Number(match[2]) : monthNames.indexOf(monthText) + 1;
    }
  }

  if (!month || !day) return null;
  const result = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const check = new Date(`${result}T00:00:00Z`);
  return check.getUTCFullYear() === year && check.getUTCMonth() + 1 === month && check.getUTCDate() === day ? result : null;
}

function readHouseholds() {
  const workbook = XLSX.readFile(workbookPath, { cellDates: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true, blankrows: false });
  const households = [];
  let current = null;
  let defaultedBirthDates = 0;

  for (const row of rows.slice(5)) {
    const householdCell = clean(row[0]);
    const memberName = clean(row[1]);
    if (/^\d+$/.test(householdCell)) {
      current = {
        sourceNumber: Number(householdCell),
        householdNumber: `Z6-${Number(householdCell)}`,
        address: 'Zone 6, Barangay Colacling',
        headName: null,
        members: []
      };
      households.push(current);
    }
    if (!memberName) continue;
    if (!current) throw new Error(`Resident row found before the first household: ${memberName}`);

    const relationship = clean(row[3]).toUpperCase();
    if ((relationship === 'HH' || relationship === 'HEAD') && !current.headName) current.headName = memberName;
    const parsedBirthDate = birthDate(row[4], row[5]);
    if (!parsedBirthDate) defaultedBirthDates += 1;
    const sexCode = clean(row[2]).toUpperCase();
    const pwd = normalizedFlag(row[15]);
    const soloParent = normalizedFlag(row[16]);

    current.members.push({
      fullName: memberName,
      relationship: relationship || null,
      birthDate: parsedBirthDate || '2000-01-01',
      sex: sexCode === 'M' ? 'Male' : sexCode === 'F' ? 'Female' : 'Prefer not to say',
      maritalStatus: nullable(row[7]),
      outOfSchoolYouth: normalizedFlag(row[8]),
      occupation: nullable(row[9]),
      education: nullable(row[10]),
      philsysNumber: nullable(row[11]),
      philhealthNumber: nullable(row[12]),
      fpUse: normalizedFlag(row[13]),
      unmetNeeds: normalizedFlag(row[14]),
      pwdSpecify: pwd,
      soloParent,
      morbidity: nullable(row[17]),
      waterSourceLevel: nullable(row[18]),
      sanitaryToilet: nullable(row[19]),
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
    const matches = zoneRows.filter((row) => /(?:^|\D)6(?:\D|$)/.test(row.zone_name) && /zone/i.test(row.zone_name));
    if (matches.length !== 1) {
      throw new Error(`Expected exactly one Zone 6 database record, found ${matches.length}. Available zones: ${zoneRows.map((row) => row.zone_name).join(', ')}`);
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
    console.log(`Imported and verified ${verified.household_count} Zone 6 households and ${verified.resident_count} residents.`);
  } finally {
    await connection.end();
  }
})().catch((error) => {
  console.error('Zone 6 import failed:', error.message || error);
  process.exitCode = 1;
});
