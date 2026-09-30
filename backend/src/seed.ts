import { createHash } from "node:crypto";
import bcrypt from "bcryptjs";
import { db } from "./db.js";

const id = (value: string) => {
  const hex = createHash("sha256").update(value).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20)}`;
};

const password = process.env.SEED_DEFAULT_PASSWORD ?? "password";
const passwordHash = await bcrypt.hash(password, 12);

const accounts: Array<[string, string, string, string, "Super Admin" | "Disaster Officer" | "Data Encoder"]> = [
  ["super-admin", "System Super Admin", "admin", "admin@bantaybaha.com", "Super Admin"],
  ["disaster-officer", "Municipal Disaster Officer", "officer", "officer@bantaybaha.com", "Disaster Officer"],
  ["data-encoder", "Community Data Encoder", "encoder", "encoder@bantaybaha.com", "Data Encoder"]
];
for (const [key, name, username, email, role] of accounts) {
  await db.execute(
    `INSERT INTO users(user_id,full_name,username,email,password_hash,role,is_active)
     VALUES(?,?,?,?,?,?,1) ON DUPLICATE KEY UPDATE
       full_name=VALUES(full_name),
       email=VALUES(email),
       role=VALUES(role),
       is_active=1`,
    [id(key), name, username, email, passwordHash, role]
  );
}

const zones: Array<[string, "Low" | "Medium" | "High", number, number]> = [
  ["Zone 1 - Riverside", "High", 13.7830, 122.8660],
  ["Zone 2 - Centro", "Medium", 13.7795, 122.8708],
  ["Zone 3 - East Ridge", "Low", 13.7810, 122.8760],
  ["Zone 4 - South Fields", "Medium", 13.7740, 122.8710],
  ["Zone 5 - Upper Colacling", "Low", 13.7870, 122.8720]
];
for (const [index, [name, risk, lat, lng]] of zones.entries()) {
  const d = 0.002;
  const polygon = {
    type: "Polygon",
    coordinates: [[[lng - d, lat - d], [lng + d, lat - d], [lng + d, lat + d], [lng - d, lat + d], [lng - d, lat - d]]]
  };
  await db.execute(
    `INSERT INTO zones(zone_id,zone_name,risk_level,polygon_geojson,description)
     VALUES(?,?,?,?,?) ON DUPLICATE KEY UPDATE risk_level=VALUES(risk_level),polygon_geojson=VALUES(polygon_geojson)`,
    [id(`zone-${index + 1}`), name, risk, JSON.stringify(polygon), `Generated demonstration boundary for ${name}`]
  );
  await db.execute(
    `INSERT INTO risk_zones(risk_zone_id,risk_zone_name,risk_level,polygon_geojson,description)
     VALUES(?,?,?,?,?) ON DUPLICATE KEY UPDATE risk_level=VALUES(risk_level),polygon_geojson=VALUES(polygon_geojson)`,
    [id(`risk-zone-${index + 1}`), `${name} Flood Risk Area`, risk, JSON.stringify(polygon), `Generated ${risk.toLowerCase()}-risk overlay near ${name}`]
  );
}

const vulnerabilities = [null, null, "Elderly", "Child", "Disability", "Pregnant", "Mobility-limited"];
for (let h = 1; h <= 25; h++) {
  const zoneNumber = ((h - 1) % 5) + 1;
  const householdNumberWithinZone = Math.floor((h - 1) / 5) + 1;
  const zoneId = id(`zone-${zoneNumber}`);
  const generatedHouseholdId = id(`household-${h}`);
  await db.execute(
    `INSERT INTO households(household_id,household_number,zone_id,address_line,head_of_household_name,contact_number,verification_status)
     VALUES(?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE zone_id=VALUES(zone_id),address_line=VALUES(address_line),verification_status=VALUES(verification_status)`,
    [generatedHouseholdId, `Z${zoneNumber}-${householdNumberWithinZone}`, zoneId, `Purok ${zoneNumber}, Barangay Colacling`, `Resident Head ${h}`, `0917000${String(h).padStart(4, "0")}`, h % 5 === 0 ? "Pending Verification" : "Verified"]
  );
  // A local database may already contain this unique household number under a
  // different UUID. Use the persisted ID so resident foreign keys remain valid.
  const [persistedHouseholds] = await db.execute<import("mysql2").RowDataPacket[]>(
    "SELECT household_id FROM households WHERE household_number=? LIMIT 1",
    [`Z${zoneNumber}-${householdNumberWithinZone}`]
  );
  const householdId = String(persistedHouseholds[0]!.household_id);
  for (let member = 1; member <= 3; member++) {
    const vulnerability = vulnerabilities[(h + member) % vulnerabilities.length] ?? null;
    const year = vulnerability === "Elderly" ? 1950 + (h % 12) : vulnerability === "Child" ? 2015 + (h % 7) : 1980 + ((h * member) % 25);
    await db.execute(
      `INSERT INTO residents(resident_id,household_id,full_name,date_of_birth,sex,address_line,vulnerability_type,priority_level,evacuation_status)
       VALUES(?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE vulnerability_type=VALUES(vulnerability_type)`,
      [id(`resident-${h}-${member}`), householdId, `Demo Resident ${h}-${member}`, `${year}-0${member + 1}-15`, member % 2 ? "Female" : "Male", `Purok ${((h - 1) % 5) + 1}, Barangay Colacling`, vulnerability, vulnerability ? "High" : "Low", h % 6 === 0 ? "For Monitoring" : "Safe"]
    );
  }
}

for (let i = 1; i <= 3; i++) {
  const zone = zones[i - 1]!;
  await db.execute(
    `INSERT INTO shelters(shelter_id,shelter_name,zone_id,location_text,latitude,longitude,capacity,current_occupancy,contact_person,contact_number,email,status)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE current_occupancy=VALUES(current_occupancy)`,
    [id(`shelter-${i}`), `Colacling Evacuation Center ${i}`, id(`zone-${i + 2}`), zone[0], Number(zone[2]) + 0.002, Number(zone[3]) + 0.002, 100 + i * 50, i * 18, `Shelter Coordinator ${i}`, `0918111000${i}`, `shelter${i}@bantaybaha.local`, i === 3 ? "Near Capacity" : "Available"]
  );
}

for (let i = 1; i <= 12; i++) {
  await db.execute(
    `INSERT INTO volunteers(volunteer_id,full_name,contact_number,email,assigned_zone_id,availability_status)
     VALUES(?,?,?,?,?,?) ON DUPLICATE KEY UPDATE availability_status=VALUES(availability_status)`,
    [id(`volunteer-${i}`), `Demo Volunteer ${i}`, `0922000${String(i).padStart(4, "0")}`, `volunteer${i}@example.test`, id(`zone-${((i - 1) % 5) + 1}`), i % 4 === 0 ? "Unavailable" : i % 3 === 0 ? "Assigned" : "Available"]
  );
}

for (let i = 1; i <= 5; i++) {
  await db.execute(
    `INSERT INTO emergency_contacts(emergency_contact_id,organization_name,contact_person,phone_number,email)
     VALUES(?,?,?,?,?) ON DUPLICATE KEY UPDATE phone_number=VALUES(phone_number)`,
    [id(`contact-${i}`), `Demo Emergency Service ${i}`, `Duty Officer ${i}`, `05480000${i}`, `emergency${i}@example.test`]
  );
}

for (let i = 1; i <= 3; i++) {
  const startZone = zones[i - 1]!;
  const endZone = zones[i + 1]!;
  const route = {
    type: "LineString",
    coordinates: [[startZone[3], startZone[2]], [122.871 + i * 0.001, 13.779 + i * 0.001], [endZone[3], endZone[2]]]
  };
  await db.execute(
    `INSERT INTO evacuation_routes(route_id,route_name,origin_zone_id,destination_shelter_id,route_geojson,status,description)
     VALUES(?,?,?,?,?,'Open',?) ON DUPLICATE KEY UPDATE route_geojson=VALUES(route_geojson)`,
    [id(`route-${i}`), `Evacuation Route ${i}`, id(`zone-${i}`), id(`shelter-${i}`), JSON.stringify(route), `Generated safe route from ${startZone[0]} to Evacuation Center ${i}`]
  );
}

const reportStatuses = ["Submitted", "Under Review", "Validated", "Rejected", "Resolved", "Validated"] as const;
const severities = ["Information", "Minor Incident", "Major Incident"] as const;
for (let i = 1; i <= 6; i++) {
  const reportId = id(`report-${i}`);
  const severity = severities[(i - 1) % 3]!;
  const reportStatus = reportStatuses[i - 1]!;
  await db.execute(
    `INSERT INTO flood_reports(report_id,tracking_code,reporter_name,location_text,incident_type,latitude,longitude,description,photo_urls,severity_level,status,validation_notes,validated_by_user_id,validated_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE status=VALUES(status),severity_level=VALUES(severity_level),incident_type=VALUES(incident_type)`,
    [
      reportId, `BB-DEMO-${String(i).padStart(3, "0")}`, i % 2 ? null : `Demo Reporter ${i}`, zones[(i - 1) % 5]![0],
      i % 3 === 0 ? "River Flooding" : i % 2 === 0 ? "Road Flooding" : "Rising Water",
      zones[(i - 1) % 5]![2], zones[(i - 1) % 5]![3], `Generated flood situation report number ${i} for demonstration.`, "[]",
      severity, reportStatus, i >= 3 ? "Reviewed demonstration report." : null,
      i >= 3 ? id("disaster-officer") : null, i >= 3 ? new Date() : null
    ]
  );
  if (reportStatus === "Validated") {
    await db.execute(
      "INSERT IGNORE INTO flood_report_zones(report_id,zone_id) VALUES(?,?)",
      [reportId, id(`zone-${((i - 1) % 5) + 1}`)]
    );
  }
}

const audiences = ["Public", "Affected Zones", "Internal Admin Users", "Public"] as const;
for (let i = 1; i <= 4; i++) {
  const severity = severities[(i - 1) % 3]!;
  const audience = audiences[i - 1]!;
  await db.execute(
    `INSERT INTO notifications(notification_id,flood_report_id,title,message,type,severity_level,target_audience,status,sent_by_user_id,sent_at)
     VALUES(?,?,?,?,?,?,?,'Sent',?,NOW()) ON DUPLICATE KEY UPDATE message=VALUES(message)`,
    [
      id(`notification-${i}`), i < 3 ? id(`report-${i + 2}`) : null, `Demonstration Advisory ${i}`,
      `Generated advisory message ${i}. Follow official barangay safety instructions.`, i === 4 ? "System Update" : "Flood Advisory",
      severity, audience, id("disaster-officer")
    ]
  );
  if (audience === "Affected Zones") {
    await db.execute(
      "INSERT IGNORE INTO notification_target_zones(notification_id,zone_id) VALUES(?,?)",
      [id(`notification-${i}`), id("zone-1")]
    );
  }
}

console.log("Operational seed data is ready.");
await db.end();
