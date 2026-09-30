const mysql = require('mysql2/promise');
const { randomUUID } = require('crypto');
const XLSX = require('xlsx');

const workbookPath = 'C:/Users/Admin/Downloads/ZONE 1.xlsx';
const dbConfig = {
  host: 'localhost',
  user: 'root',
  password: '',
  database: 'flood_monitoring',
};

const clean = (value) => {
  if (value === null || value === undefined) return '';
  return String(value).trim();
};

const parseBirthDate = (row) => {
  const monthDay = clean(row['__EMPTY_3']);
  const year = clean(row['__EMPTY_4']);
  if (!monthDay || !year) return null;
  const monthMap = {
    Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
    Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12'
  };

  const match = monthDay.match(/^([0-9]{1,2})-([A-Za-z]{3})$/);
  if (match) {
    const day = String(Number(match[1])).padStart(2, '0');
    const month = monthMap[match[2]] || '01';
    return `${year}-${month}-${day}`;
  }

  const alt = monthDay.match(/^([A-Za-z]{3})-([0-9]{1,2})$/);
  if (alt) {
    const day = String(Number(alt[2])).padStart(2, '0');
    const month = monthMap[alt[1]] || '01';
    return `${year}-${month}-${day}`;
  }

  return null;
};

(async () => {
  const connection = await mysql.createConnection(dbConfig);

  try {
    const [zoneRows] = await connection.query('SELECT zone_id, zone_name FROM zones WHERE zone_name LIKE ? ORDER BY zone_name LIMIT 1', ['%Zone 1%']);
    if (!zoneRows[0]) {
      throw new Error('Zone 1 was not found in the database.');
    }

    const zoneId = zoneRows[0].zone_id;
    const workbook = XLSX.readFile(workbookPath);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: null, raw: false, blankrows: false });

    const households = new Map();

    for (const row of rows.slice(2)) {
      const householdCell = clean(row['__EMPTY']);
      if (!/^\d+$/.test(householdCell)) continue;

      const householdNumber = Number(householdCell);
      const memberName = clean(row['BARANGAY:  COLACLING']);
      if (!memberName) continue;

      const relationship = clean(row['__EMPTY_2']).toUpperCase();
      if (!households.has(householdNumber)) {
        households.set(householdNumber, {
          household_number: `Z1-${householdNumber}`,
          zone_id: zoneId,
          address_line: 'Zone 1, Barangay Colacling',
          head_name: null,
          members: []
        });
      }

      const household = households.get(householdNumber);
      if (relationship === 'HEAD' && !household.head_name) {
        household.head_name = memberName;
      }

      household.members.push({
        member_name: memberName,
        relationship,
        date_of_birth: parseBirthDate(row) || '2000-01-01',
        sex: 'Prefer not to say',
        marital_status: clean(row['__EMPTY_5']),
        out_of_school_youth: clean(row['__EMPTY_6']),
        occupation: clean(row['__EMPTY_7']),
        education: clean(row['__EMPTY_8']),
        philsys_number: clean(row['__EMPTY_9']),
        philhealth_number: clean(row['__EMPTY_10']),
        fp_use: clean(row['DATE: ']),
        unmet_needs: clean(row['__EMPTY_11']),
        pwd_specify: clean(row['__EMPTY_12']),
        solo_parent: clean(row['__EMPTY_13']),
        morbidity: clean(row['__EMPTY_14']),
        water_source_level: clean(row['__EMPTY_15']),
        sanitary_toilet: clean(row['__EMPTY_16'])
      });
    }

    let importedHouseholds = 0;
    let importedResidents = 0;

    for (const [householdNumber, household] of households.entries()) {
      const householdId = randomUUID();
      const houseNumber = `Z1-${householdNumber}`;
      const headName = household.head_name || household.members[0]?.member_name || `Household ${householdNumber}`;

      await connection.execute(
        `INSERT INTO households (household_id, household_number, zone_id, address_line, head_of_household_name, contact_number, verification_status)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           zone_id = VALUES(zone_id),
           address_line = VALUES(address_line),
           head_of_household_name = VALUES(head_of_household_name),
           verification_status = VALUES(verification_status)`,
        [householdId, houseNumber, household.zone_id, household.address_line, headName, null, 'Verified']
      );

      for (const member of household.members) {
        const residentId = randomUUID();
        await connection.execute(
          `INSERT INTO residents (
            resident_id,
            household_id,
            full_name,
            date_of_birth,
            sex,
            contact_number,
            address_line,
            vulnerability_type,
            relationship_to_head,
            marital_status,
            out_of_school_youth,
            occupation,
            education,
            philsys_number,
            philhealth_number,
            fp_use,
            unmet_needs,
            pwd_specify,
            solo_parent,
            morbidity,
            water_source_level,
            sanitary_toilet,
            priority_level,
            evacuation_status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            household_id = VALUES(household_id),
            full_name = VALUES(full_name),
            date_of_birth = VALUES(date_of_birth),
            sex = VALUES(sex),
            address_line = VALUES(address_line),
            relationship_to_head = VALUES(relationship_to_head),
            marital_status = VALUES(marital_status),
            out_of_school_youth = VALUES(out_of_school_youth),
            occupation = VALUES(occupation),
            education = VALUES(education),
            philsys_number = VALUES(philsys_number),
            philhealth_number = VALUES(philhealth_number),
            fp_use = VALUES(fp_use),
            unmet_needs = VALUES(unmet_needs),
            pwd_specify = VALUES(pwd_specify),
            solo_parent = VALUES(solo_parent),
            morbidity = VALUES(morbidity),
            water_source_level = VALUES(water_source_level),
            sanitary_toilet = VALUES(sanitary_toilet),
            priority_level = VALUES(priority_level),
            evacuation_status = VALUES(evacuation_status)`,
          [
            residentId,
            householdId,
            member.member_name,
            member.date_of_birth,
            member.sex,
            null,
            household.address_line,
            null,
            member.relationship || null,
            member.marital_status || null,
            member.out_of_school_youth || null,
            member.occupation || null,
            member.education || null,
            member.philsys_number || null,
            member.philhealth_number || null,
            member.fp_use || null,
            member.unmet_needs || null,
            member.pwd_specify || null,
            member.solo_parent || null,
            member.morbidity || null,
            member.water_source_level || null,
            member.sanitary_toilet || null,
            'Low',
            'Safe'
          ]
        );
        importedResidents += 1;
      }

      importedHouseholds += 1;
    }

    console.log(`Imported ${importedHouseholds} households and ${importedResidents} residents from Zone 1 workbook.`);
  } finally {
    await connection.end();
  }
})().catch((error) => {
  console.error('Import failed:', error.message || error);
  process.exit(1);
});
