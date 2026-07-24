import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { readFile, unlink } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import bcrypt from "bcryptjs";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import multer from "multer";
import nodemailer from "nodemailer";
import { z } from "zod";
import { config } from "./config.js";
import { db, healthcheck } from "./db.js";
import {
  createAccessToken,
  createRefreshToken,
  requireAuth,
  requireRoles,
  revokeRefreshToken,
  rotateRefreshToken
} from "./auth.js";
import type { AuthRequest, AuthUser } from "./types.js";

mkdirSync(config.uploadRoot, { recursive: true });
const app = express();
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(cors({ origin: config.frontendOrigins, credentials: true }));
app.use(express.json({ limit: "1mb" }));

const asyncRoute = (handler: (req: any, res: any) => Promise<unknown>) =>
  (req: any, res: any, next: any) => Promise.resolve(handler(req, res)).catch(next);

const refreshCookie = {
  httpOnly: true,
  secure: config.refreshCookieSecure,
  sameSite: config.refreshCookieSameSite,
  domain: config.refreshCookieDomain,
  path: config.refreshCookiePath,
  maxAge: config.refreshCookieMaxAgeMs
};

function pagination(req: express.Request) {
  const page = Number(req.query.page ?? 1);
  const pageSize = Number(req.query.pageSize ?? config.defaultPageSize);
  if (!Number.isInteger(page) || page < 1) throw new z.ZodError([{ code: "custom", path: ["page"], message: "page must be a positive integer" }]);
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > config.maxPageSize) {
    throw new z.ZodError([{ code: "custom", path: ["pageSize"], message: `pageSize must be between 1 and ${config.maxPageSize}` }]);
  }
  return { page, pageSize, offset: (page - 1) * pageSize };
}

async function paginated(
  res: express.Response,
  table: string,
  req: express.Request,
  options: { columns?: string; where?: string; params?: unknown[]; searchColumns?: string[]; sortFields?: string[]; defaultSort?: string } = {}
) {
  const { page, pageSize, offset } = pagination(req);
  const search = String(req.query.search ?? "").trim();
  const params = [...(options.params ?? [])];
  let where = options.where ?? "1=1";
  if (search && options.searchColumns?.length) {
    where += ` AND (${options.searchColumns.map((column) => `${column} LIKE ?`).join(" OR ")})`;
    params.push(...options.searchColumns.map(() => `%${search}%`));
  }
  const allowedSorts = options.sortFields ?? ["created_at"];
  const sortBy = String(req.query.sortBy ?? options.defaultSort ?? allowedSorts[0]);
  const sortOrder = String(req.query.sortOrder ?? "desc").toLowerCase();
  if (!allowedSorts.includes(sortBy)) throw new z.ZodError([{ code: "custom", path: ["sortBy"], message: "Unsupported sortBy field" }]);
  if (!["asc", "desc"].includes(sortOrder)) throw new z.ZodError([{ code: "custom", path: ["sortOrder"], message: "sortOrder must be asc or desc" }]);
  const [items] = await db.query(
    `SELECT ${options.columns ?? "*"} FROM ${table} WHERE ${where} ORDER BY ${sortBy} ${sortOrder.toUpperCase()} LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  );
  const [countRows] = await db.query<any[]>(`SELECT COUNT(*) total FROM ${table} WHERE ${where}`, params);
  const totalItems = Number(countRows[0]?.total ?? 0);
  res.json({ items, page, pageSize, totalItems, totalPages: Math.ceil(totalItems / pageSize) });
}

app.get("/api/health", asyncRoute(async (_req, res) => {
  await healthcheck();
  res.json({ status: "ok", service: "BantayBaha API" });
}));

app.post("/api/auth/login", asyncRoute(async (req, res) => {
  const input = z.object({ username: z.string().min(1), password: z.string().min(1) }).parse(req.body);
  const [rows] = await db.execute<any[]>("SELECT * FROM users WHERE username=? AND is_active=1 LIMIT 1", [input.username]);
  const row = rows[0];
  if (!row || !(await bcrypt.compare(input.password, row.password_hash))) {
    return res.status(401).json({ message: "Invalid username or password" });
  }
  const user: AuthUser = { userId: row.user_id, username: row.username, role: row.role };
  const refreshToken = await createRefreshToken(user);
  await db.execute("UPDATE users SET last_login_at=NOW() WHERE user_id=?", [user.userId]);
  res.cookie("refreshToken", refreshToken, refreshCookie);
  res.json({ accessToken: createAccessToken(user), user: { ...user, fullName: row.full_name, email: row.email } });
}));

app.post("/api/auth/refresh", asyncRoute(async (req, res) => {
  const token = req.headers.cookie?.match(/(?:^|;\s*)refreshToken=([^;]+)/)?.[1];
  if (!token) return res.status(401).json({ message: "Refresh token required" });
  const result = await rotateRefreshToken(decodeURIComponent(token));
  res.cookie("refreshToken", result.refreshToken, refreshCookie);
  res.json({ accessToken: result.accessToken, user: result.user });
}));

app.post("/api/auth/logout", asyncRoute(async (req, res) => {
  const token = req.headers.cookie?.match(/(?:^|;\s*)refreshToken=([^;]+)/)?.[1];
  await revokeRefreshToken(token && decodeURIComponent(token));
  res.clearCookie("refreshToken", refreshCookie);
  res.status(204).end();
}));

app.get("/api/auth/me", requireAuth, asyncRoute(async (req: AuthRequest, res) => {
  const [rows] = await db.execute<any[]>(
    "SELECT user_id userId,full_name fullName,username,email,role,is_active isActive,last_login_at lastLoginAt FROM users WHERE user_id=?",
    [req.user!.userId]
  );
  res.json(rows[0]);
}));

const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
async function issuePasswordReset(userId: string, email: string) {
  const token = randomBytes(32).toString("hex");
  await db.execute(
    "INSERT INTO password_reset_tokens(password_reset_token_id,user_id,token_hash,expires_at) VALUES(?,?,?,DATE_ADD(NOW(),INTERVAL 30 MINUTE))",
    [randomUUID(), userId, tokenHash(token)]
  );
  if (config.smtpHost) {
    const transport = nodemailer.createTransport({
      host: config.smtpHost, port: config.smtpPort, secure: config.smtpSecure,
      auth: config.smtpUser ? { user: config.smtpUser, pass: config.smtpPassword } : undefined
    });
    await transport.sendMail({
      from: config.smtpFrom, to: email, subject: "Reset your BantayBaha password",
      text: `Reset your password within 30 minutes: ${config.passwordResetUrl}?token=${token}`
    });
  } else if (!config.isProduction) {
    console.info(`Development password reset URL: ${config.passwordResetUrl}?token=${token}`);
  } else {
    throw new Error("Password recovery email is not configured");
  }
}

app.post("/api/auth/forgot-password", asyncRoute(async (req, res) => {
  const { email } = z.object({ email: z.string().email() }).parse(req.body);
  const [rows] = await db.execute<any[]>("SELECT user_id,email FROM users WHERE email=? AND is_active=1 LIMIT 1", [email]);
  if (rows[0]) await issuePasswordReset(rows[0].user_id, rows[0].email);
  res.status(202).json({ message: "If an active account exists, password-reset instructions will be sent." });
}));

app.post("/api/auth/reset-password", asyncRoute(async (req, res) => {
  const input = z.object({
    token: z.string().min(32),
    password: z.string().min(12).regex(/[A-Z]/).regex(/[a-z]/).regex(/\d/)
  }).parse(req.body);
  const [rows] = await db.execute<any[]>(
    "SELECT password_reset_token_id,user_id FROM password_reset_tokens WHERE token_hash=? AND used_at IS NULL AND expires_at>NOW() LIMIT 1",
    [tokenHash(input.token)]
  );
  if (!rows[0]) return res.status(400).json({ message: "Reset token is invalid or expired" });
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute("UPDATE users SET password_hash=? WHERE user_id=?", [await bcrypt.hash(input.password, 12), rows[0].user_id]);
    await connection.execute("UPDATE password_reset_tokens SET used_at=NOW() WHERE password_reset_token_id=?", [rows[0].password_reset_token_id]);
    await connection.execute("UPDATE refresh_tokens SET revoked_at=NOW() WHERE user_id=? AND revoked_at IS NULL", [rows[0].user_id]);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  res.status(204).end();
}));

const userInput = z.object({
  fullName: z.string().min(2),
  username: z.string().min(3),
  email: z.string().email(),
  role: z.enum(["Super Admin", "Disaster Officer", "Data Encoder"]),
  password: z.string().min(12).regex(/[A-Z]/).regex(/[a-z]/).regex(/\d/).optional()
});

app.get("/api/users", requireAuth, requireRoles("Super Admin"), asyncRoute(async (req, res) => paginated(res, "users", req, {
  columns: "user_id,full_name,username,email,role,is_active,last_login_at,created_at,updated_at",
  searchColumns: ["full_name", "username", "email"],
  sortFields: ["full_name", "username", "email", "role", "is_active", "last_login_at", "created_at"]
})));
app.post("/api/users", requireAuth, requireRoles("Super Admin"), asyncRoute(async (req, res) => {
  const input = userInput.extend({ password: userInput.shape.password.unwrap() }).parse(req.body);
  const id = randomUUID();
  await db.execute(
    "INSERT INTO users(user_id,full_name,username,email,password_hash,role) VALUES(?,?,?,?,?,?)",
    [id, input.fullName, input.username, input.email, await bcrypt.hash(input.password, 12), input.role]
  );
  res.status(201).json({ userId: id });
}));
app.get("/api/users/:id", requireAuth, requireRoles("Super Admin"), asyncRoute(async (req, res) => {
  const [rows] = await db.execute("SELECT user_id userId,full_name fullName,username,email,role,is_active isActive,last_login_at lastLoginAt FROM users WHERE user_id=?", [String(req.params.id)]);
  res.json((rows as any[])[0]);
}));
app.put("/api/users/:id", requireAuth, requireRoles("Super Admin"), asyncRoute(async (req, res) => {
  const input = userInput.omit({ password: true }).parse(req.body);
  await db.execute("UPDATE users SET full_name=?,username=?,email=?,role=? WHERE user_id=?", [input.fullName, input.username, input.email, input.role, String(req.params.id)]);
  res.status(204).end();
}));
app.put("/api/users/:id/active-status", requireAuth, requireRoles("Super Admin"), asyncRoute(async (req: AuthRequest, res) => {
  const { isActive } = z.object({ isActive: z.boolean() }).parse(req.body);
  const targetId = String(req.params.id);
  if (targetId === req.user!.userId && !isActive) return res.status(400).json({ message: "You cannot deactivate your own account" });
  if (!isActive) {
    const [rows] = await db.query<any[]>("SELECT COUNT(*) total FROM users WHERE role='Super Admin' AND is_active=1");
    const [target] = await db.query<any[]>("SELECT role,is_active FROM users WHERE user_id=?", [targetId]);
    if (target[0]?.role === "Super Admin" && target[0]?.is_active && Number(rows[0]?.total) <= 1) {
      return res.status(400).json({ message: "The last active Super Admin cannot be deactivated" });
    }
  }
  await db.execute("UPDATE users SET is_active=? WHERE user_id=?", [isActive, targetId]);
  if (!isActive) await db.execute("UPDATE refresh_tokens SET revoked_at=NOW() WHERE user_id=? AND revoked_at IS NULL", [targetId]);
  res.status(204).end();
}));
app.post("/api/users/:id/reset-password", requireAuth, requireRoles("Super Admin"), asyncRoute(async (req, res) => {
  const [rows] = await db.execute<any[]>("SELECT user_id,email FROM users WHERE user_id=? AND is_active=1 LIMIT 1", [String(req.params.id)]);
  if (!rows[0]) return res.status(404).json({ message: "Active user account not found" });
  await issuePasswordReset(rows[0].user_id, rows[0].email);
  res.status(202).json({ message: "Password-reset instructions have been initiated." });
}));

const photoStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const now = new Date();
    const dir = join(config.uploadRoot, "flood-reports", String(now.getFullYear()), String(now.getMonth() + 1).padStart(2, "0"));
    mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => cb(null, `${randomUUID()}${file.mimetype === "image/png" ? ".png" : ".jpg"}`)
});
const uploads = multer({
  storage: photoStorage,
  limits: { fileSize: 5 * 1024 * 1024, files: 5 },
  fileFilter: (_req, file, cb) => cb(null,
    ["image/jpeg", "image/png"].includes(file.mimetype) &&
    [".jpg", ".jpeg", ".png"].includes(extname(file.originalname).toLowerCase())
  )
});

app.post("/api/flood-reports", uploads.array("photos", 5), asyncRoute(async (req, res) => {
  const input = z.object({
    reporterName: z.string().optional(),
    reporterContactInfo: z.string().optional(),
    locationText: z.string().min(2),
    incidentType: z.enum(["River Flooding", "Flash Flood", "Road Flooding", "Drainage Overflow", "Rising Water", "Other"]),
    severityLevel: z.enum(["Information", "Minor Incident", "Major Incident"]),
    latitude: z.coerce.number().min(-90).max(90),
    longitude: z.coerce.number().min(-180).max(180),
    description: z.string().min(10)
  }).parse(req.body);
  const uploadedFiles = ((req.files as Express.Multer.File[]) ?? []);
  for (const file of uploadedFiles) {
    const signature = (await readFile(file.path)).subarray(0, 8);
    const isJpeg = signature[0] === 0xff && signature[1] === 0xd8 && signature[2] === 0xff;
    const isPng = signature.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    if (!isJpeg && !isPng) {
      await Promise.all(uploadedFiles.map((uploaded) => unlink(uploaded.path).catch(() => undefined)));
      return res.status(400).json({ message: "Only valid JPEG and PNG photo files are accepted" });
    }
  }
  const id = randomUUID();
  const trackingCode = `BB-${new Date().getFullYear()}-${id.slice(0, 8).toUpperCase()}`;
  const photos = uploadedFiles.map((file) => file.path.slice(config.uploadRoot.length).replaceAll("\\", "/"));
  await db.execute(
    "INSERT INTO flood_reports(report_id,tracking_code,reporter_name,reporter_contact_info,location_text,incident_type,latitude,longitude,description,photo_urls,severity_level) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
    [id, trackingCode, input.reporterName ?? null, input.reporterContactInfo ?? null, input.locationText, input.incidentType, input.latitude, input.longitude, input.description, JSON.stringify(photos), input.severityLevel]
  );
  res.status(201).json({ reportId: id, trackingCode, status: "Submitted" });
}));

app.get("/api/flood-reports/public", asyncRoute(async (req, res) => paginated(res, "flood_reports", req, {
  columns: "report_id,tracking_code,location_text,incident_type,latitude,longitude,description,photo_urls,severity_level,status,validated_at,created_at,updated_at",
  where: "status='Validated'",
  searchColumns: ["tracking_code", "location_text", "description"],
  sortFields: ["created_at", "validated_at", "severity_level", "location_text"]
})));
app.get("/api/flood-reports", requireAuth, requireRoles("Super Admin", "Disaster Officer"), asyncRoute(async (req, res) => paginated(res, "flood_reports", req, {
  searchColumns: ["tracking_code", "reporter_name", "location_text", "description", "status"],
  sortFields: ["created_at", "updated_at", "severity_level", "status", "location_text"]
})));
app.get("/api/flood-reports/pending-count", requireAuth, requireRoles("Super Admin", "Disaster Officer"), asyncRoute(async (_req, res) => {
  const [rows] = await db.query<any[]>("SELECT COUNT(*) pendingCount FROM flood_reports WHERE status IN ('Submitted','Under Review')");
  res.json({ pendingCount: Number(rows[0]?.pendingCount ?? 0) });
}));
app.get("/api/flood-reports/:id", requireAuth, requireRoles("Super Admin", "Disaster Officer"), asyncRoute(async (req, res) => {
  const [rows] = await db.query<any[]>(
    `SELECT fr.*,COALESCE(JSON_ARRAYAGG(frz.zone_id),JSON_ARRAY()) affected_zone_ids
     FROM flood_reports fr LEFT JOIN flood_report_zones frz ON frz.report_id=fr.report_id
     WHERE fr.report_id=? GROUP BY fr.report_id`,
    [String(req.params.id)]
  );
  if (!rows[0]) return res.status(404).json({ message: "Flood report not found" });
  res.json(rows[0]);
}));

async function serveReportPhoto(reportId: string, indexValue: string, publicOnly: boolean, res: express.Response) {
  const [rows] = await db.query<any[]>(
    `SELECT photo_urls,status FROM flood_reports WHERE report_id=? ${publicOnly ? "AND status='Validated'" : ""} LIMIT 1`,
    [reportId]
  );
  if (!rows[0]) return res.status(404).json({ message: "Flood report not found" });
  const photoUrls = typeof rows[0].photo_urls === "string" ? JSON.parse(rows[0].photo_urls) : rows[0].photo_urls;
  const relativePath = Array.isArray(photoUrls) ? photoUrls[Number(indexValue)] : undefined;
  if (!relativePath) return res.status(404).json({ message: "Photo not found" });
  const absolutePath = resolve(config.uploadRoot, `.${String(relativePath)}`);
  if (!absolutePath.startsWith(`${config.uploadRoot}${sep}`)) return res.status(400).json({ message: "Invalid photo path" });
  res.sendFile(absolutePath);
}
app.get("/api/flood-reports/public/:id/photos/:index", asyncRoute(async (req, res) =>
  serveReportPhoto(String(req.params.id), String(req.params.index), true, res)
));
app.get("/api/flood-reports/:id/photos/:index", requireAuth, requireRoles("Super Admin", "Disaster Officer"), asyncRoute(async (req, res) =>
  serveReportPhoto(String(req.params.id), String(req.params.index), false, res)
));
app.put("/api/flood-reports/:id/status", requireAuth, requireRoles("Super Admin", "Disaster Officer"), asyncRoute(async (req: AuthRequest, res) => {
  const input = z.object({
    status: z.enum(["Under Review", "Validated", "Rejected", "Resolved"]),
    severityLevel: z.enum(["Information", "Minor Incident", "Major Incident"]),
    validationNotes: z.string().min(3),
    zoneIds: z.array(z.string().uuid()).min(1, "Select at least one affected Barangay Zone")
  }).parse(req.body);
  const uniqueZoneIds = [...new Set(input.zoneIds)];
  const [zones] = await db.query<any[]>("SELECT zone_id FROM zones WHERE zone_id IN (?)", [uniqueZoneIds]);
  if (zones.length !== uniqueZoneIds.length) return res.status(400).json({ message: "One or more selected Barangay Zones do not exist" });
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute(
      "UPDATE flood_reports SET status=?,severity_level=?,validation_notes=?,validated_by_user_id=?,validated_at=IF(?='Validated',NOW(),validated_at) WHERE report_id=?",
      [input.status, input.severityLevel, input.validationNotes, req.user!.userId, input.status, String(req.params.id)]
    );
    await connection.execute("DELETE FROM flood_report_zones WHERE report_id=?", [String(req.params.id)]);
    for (const zoneId of uniqueZoneIds) await connection.execute("INSERT INTO flood_report_zones(report_id,zone_id) VALUES(?,?)", [String(req.params.id), zoneId]);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  res.status(204).end();
}));

app.get("/api/map/live", asyncRoute(async (_req, res) => {
  const [[zones], [riskZones], [shelters], [reports], [routes]] = await Promise.all([
    db.query("SELECT * FROM zones"),
    db.query("SELECT * FROM risk_zones"),
    db.query("SELECT * FROM shelters WHERE status!='Unavailable'"),
    db.query(`SELECT report_id,tracking_code,location_text,incident_type,latitude,longitude,description,photo_urls,severity_level,status,validated_at,created_at
              FROM flood_reports WHERE status='Validated'`),
    db.query("SELECT * FROM evacuation_routes WHERE status!='Closed'")
  ]);
  res.json({ center: { latitude: 13.7795, longitude: 122.8708 }, zones, riskZones, shelters, reports, routes, refreshedAt: new Date().toISOString() });
}));

app.get("/api/emergency-contacts/public", asyncRoute(async (_req, res) => {
  const [items] = await db.query(
    "SELECT emergency_contact_id,organization_name,contact_person,phone_number,email FROM emergency_contacts WHERE is_public=1 AND status='Active' ORDER BY organization_name"
  );
  res.json({ items });
}));

type ResourceConfig = {
  table: string;
  idColumn: string;
  columns?: string;
  readRoles: Array<"Super Admin" | "Disaster Officer" | "Data Encoder">;
  writeRoles: Array<"Super Admin" | "Disaster Officer" | "Data Encoder">;
  fields: Record<string, string>;
  required: string[];
  jsonFields?: string[];
  searchColumns: string[];
  sortFields: string[];
};

const resources: Record<string, ResourceConfig> = {
  "barangay-zones": {
    table: "zones", idColumn: "zone_id", readRoles: ["Super Admin", "Disaster Officer", "Data Encoder"], writeRoles: ["Super Admin"],
    fields: { zoneName: "zone_name", polygonGeoJson: "polygon_geojson", description: "description" },
    required: ["zoneName", "polygonGeoJson"], jsonFields: ["polygonGeoJson"],
    searchColumns: ["zone_name", "description"], sortFields: ["zone_name", "created_at", "updated_at"]
  },
  "risk-zones": {
    table: "risk_zones", idColumn: "risk_zone_id", readRoles: ["Super Admin", "Disaster Officer", "Data Encoder"], writeRoles: ["Super Admin"],
    fields: { riskZoneName: "risk_zone_name", riskLevel: "risk_level", polygonGeoJson: "polygon_geojson", description: "description" },
    required: ["riskZoneName", "riskLevel", "polygonGeoJson"], jsonFields: ["polygonGeoJson"],
    searchColumns: ["risk_zone_name", "description"], sortFields: ["risk_zone_name", "risk_level", "created_at", "updated_at"]
  },
  households: {
    table: "households h", idColumn: "household_id",
    columns: `h.*,
      (SELECT COUNT(*) FROM residents r WHERE r.household_id=h.household_id) member_count,
      (SELECT z.risk_level FROM zones z WHERE z.zone_id=h.zone_id) risk_level,
      CASE
        WHEN EXISTS(SELECT 1 FROM residents r WHERE r.household_id=h.household_id AND r.evacuation_status='For Evacuation') THEN 'For Evacuation'
        WHEN EXISTS(SELECT 1 FROM residents r WHERE r.household_id=h.household_id AND r.evacuation_status='For Monitoring') THEN 'For Monitoring'
        WHEN EXISTS(SELECT 1 FROM residents r WHERE r.household_id=h.household_id AND r.evacuation_status!='Evacuated') THEN 'Safe'
        WHEN EXISTS(SELECT 1 FROM residents r WHERE r.household_id=h.household_id) THEN 'Evacuated'
        ELSE 'Safe' END evacuation_status`,
    readRoles: ["Super Admin", "Data Encoder"], writeRoles: ["Super Admin", "Data Encoder"],
    fields: { householdNumber: "household_number", zoneId: "zone_id", addressLine: "address_line", headOfHouseholdName: "head_of_household_name", contactNumber: "contact_number", verificationStatus: "verification_status" },
    required: ["householdNumber", "zoneId", "addressLine", "headOfHouseholdName"],
    searchColumns: ["h.household_number", "h.address_line", "h.head_of_household_name", "h.verification_status"], sortFields: ["household_number", "address_line", "verification_status", "created_at", "updated_at"]
  },
  residents: {
    table: "residents r", idColumn: "resident_id", columns: "r.*,TIMESTAMPDIFF(YEAR,r.date_of_birth,CURDATE()) age",
    readRoles: ["Super Admin", "Data Encoder"], writeRoles: ["Super Admin", "Data Encoder"],
    fields: { householdId: "household_id", fullName: "full_name", dateOfBirth: "date_of_birth", sex: "sex", contactNumber: "contact_number", addressLine: "address_line", vulnerabilityType: "vulnerability_type", emergencyContactName: "emergency_contact_name", emergencyContactNumber: "emergency_contact_number", priorityLevel: "priority_level", evacuationStatus: "evacuation_status" },
    required: ["householdId", "fullName", "dateOfBirth", "sex", "addressLine", "priorityLevel", "evacuationStatus"],
    searchColumns: ["r.full_name", "r.address_line", "r.vulnerability_type"], sortFields: ["r.full_name", "r.date_of_birth", "r.priority_level", "r.evacuation_status", "r.created_at", "r.updated_at"]
  },
  shelters: {
    table: "shelters", idColumn: "shelter_id", readRoles: ["Super Admin", "Disaster Officer", "Data Encoder"], writeRoles: ["Super Admin", "Disaster Officer", "Data Encoder"],
    fields: { shelterName: "shelter_name", zoneId: "zone_id", locationText: "location_text", latitude: "latitude", longitude: "longitude", capacity: "capacity", currentOccupancy: "current_occupancy", contactPerson: "contact_person", contactNumber: "contact_number", email: "email", status: "status" },
    required: ["shelterName", "zoneId", "locationText", "latitude", "longitude", "capacity", "currentOccupancy", "contactPerson", "contactNumber", "status"],
    searchColumns: ["shelter_name", "location_text", "contact_person"], sortFields: ["shelter_name", "capacity", "current_occupancy", "status", "created_at", "updated_at"]
  },
  volunteers: {
    table: "volunteers", idColumn: "volunteer_id", readRoles: ["Super Admin", "Disaster Officer", "Data Encoder"], writeRoles: ["Super Admin", "Disaster Officer", "Data Encoder"],
    fields: { fullName: "full_name", contactNumber: "contact_number", email: "email", assignedZoneId: "assigned_zone_id", availabilityStatus: "availability_status", notes: "notes" },
    required: ["fullName", "contactNumber", "availabilityStatus"],
    searchColumns: ["full_name", "contact_number", "email"], sortFields: ["full_name", "availability_status", "created_at", "updated_at"]
  },
  "evacuation-routes": {
    table: "evacuation_routes", idColumn: "route_id", readRoles: ["Super Admin", "Disaster Officer", "Data Encoder"], writeRoles: ["Super Admin", "Disaster Officer"],
    fields: { routeName: "route_name", originZoneId: "origin_zone_id", destinationShelterId: "destination_shelter_id", routeGeoJson: "route_geojson", status: "status", description: "description" },
    required: ["routeName", "originZoneId", "destinationShelterId", "routeGeoJson", "status"], jsonFields: ["routeGeoJson"],
    searchColumns: ["route_name", "description", "status"], sortFields: ["route_name", "status", "created_at", "updated_at"]
  },
  "emergency-contacts": {
    table: "emergency_contacts", idColumn: "emergency_contact_id", readRoles: ["Super Admin", "Disaster Officer", "Data Encoder"], writeRoles: ["Super Admin", "Disaster Officer", "Data Encoder"],
    fields: { organizationName: "organization_name", contactPerson: "contact_person", phoneNumber: "phone_number", email: "email", isPublic: "is_public", status: "status" },
    required: ["organizationName", "phoneNumber", "isPublic", "status"],
    searchColumns: ["organization_name", "contact_person", "phone_number", "email"], sortFields: ["organization_name", "status", "created_at", "updated_at"]
  }
};

const baseTable = (table: string) => table.split(" ")[0]!;
async function validateResource(path: string, body: Record<string, any>, recordId?: string) {
  for (const [key, value] of Object.entries(body)) {
    if (key.toLowerCase().includes("email") && value && !z.string().email().safeParse(value).success) throw new z.ZodError([{ code: "custom", path: [key], message: "Invalid email format" }]);
  }
  const references: Partial<Record<string, Array<{ field: string; table: string; column: string; label: string; optional?: boolean }>>> = {
    households: [{ field: "zoneId", table: "zones", column: "zone_id", label: "zone" }],
    shelters: [{ field: "zoneId", table: "zones", column: "zone_id", label: "zone" }],
    volunteers: [{ field: "assignedZoneId", table: "zones", column: "zone_id", label: "assigned zone", optional: true }],
    "evacuation-routes": [
      { field: "originZoneId", table: "zones", column: "zone_id", label: "origin zone" },
      { field: "destinationShelterId", table: "shelters", column: "shelter_id", label: "destination shelter" }
    ]
  };
  for (const reference of references[path] ?? []) {
    const value = body[reference.field];
    if ((value === undefined || value === null || value === "") && reference.optional) continue;
    if (value === undefined) continue;
    const [matches] = await db.query<any[]>(
      `SELECT ${reference.column} FROM ${reference.table} WHERE ${reference.column}=? LIMIT 1`,
      [value]
    );
    if (!matches[0]) throw new z.ZodError([{ code: "custom", path: [reference.field], message: `Select an existing ${reference.label}` }]);
  }
  if (path === "residents") {
    if (body.dateOfBirth && new Date(body.dateOfBirth) > new Date()) throw new z.ZodError([{ code: "custom", path: ["dateOfBirth"], message: "Date of birth cannot be in the future" }]);
    if (body.householdId) {
      const [households] = await db.query<any[]>("SELECT household_id FROM households WHERE household_id=? LIMIT 1", [body.householdId]);
      if (!households[0]) {
        throw new z.ZodError([{ code: "custom", path: ["householdId"], message: "Select an existing household" }]);
      }
    }
    for (const field of ["contactNumber", "emergencyContactNumber"]) {
      if (body[field] && !/^\d+$/.test(String(body[field]))) throw new z.ZodError([{ code: "custom", path: [field], message: `${field} must contain digits only` }]);
    }
    if (body.fullName && body.dateOfBirth && body.householdId) {
      const [duplicates] = await db.query<any[]>(
        "SELECT resident_id FROM residents WHERE full_name=? AND date_of_birth=? AND household_id=? AND (? IS NULL OR resident_id!=?) LIMIT 1",
        [body.fullName, body.dateOfBirth, body.householdId, recordId ?? null, recordId ?? null]
      );
      if (duplicates[0]) throw Object.assign(new Error("Duplicate resident record"), { code: "ER_DUP_ENTRY" });
    }
  }
  if (path === "households" && body.verificationStatus !== undefined) {
    const validStatuses = ["Pending Verification", "Verified", "Rejected"];
    if (!validStatuses.includes(String(body.verificationStatus))) {
      throw new z.ZodError([{ code: "custom", path: ["verificationStatus"], message: "Select a valid household verification status" }]);
    }
  }
  if (["barangay-zones", "risk-zones"].includes(path) && body.polygonGeoJson && body.polygonGeoJson.type !== "Polygon" && body.polygonGeoJson.type !== "MultiPolygon") {
    throw new z.ZodError([{ code: "custom", path: ["polygonGeoJson"], message: "Zone geometry must be a GeoJSON Polygon or MultiPolygon" }]);
  }
  if (path === "evacuation-routes" && body.routeGeoJson && body.routeGeoJson.type !== "LineString" && body.routeGeoJson.type !== "MultiLineString") {
    throw new z.ZodError([{ code: "custom", path: ["routeGeoJson"], message: "Route geometry must be a GeoJSON LineString or MultiLineString" }]);
  }
  if (path === "shelters") {
    for (const field of ["capacity", "currentOccupancy"]) if (body[field] !== undefined && (!Number.isInteger(Number(body[field])) || Number(body[field]) < 0)) {
      throw new z.ZodError([{ code: "custom", path: [field], message: `${field} must be a non-negative whole number` }]);
    }
  }
  const phoneFields: Partial<Record<string, string[]>> = {
    shelters: ["contactNumber"],
    volunteers: ["contactNumber"],
    "emergency-contacts": ["phoneNumber"]
  };
  for (const field of phoneFields[path] ?? []) {
    if (body[field] && !/^[0-9+() -]{7,30}$/.test(String(body[field]))) {
      throw new z.ZodError([{ code: "custom", path: [field], message: `${field} must be a valid phone number` }]);
    }
  }
}
for (const [path, resource] of Object.entries(resources)) {
  app.get(`/api/${path}`, requireAuth, requireRoles(...resource.readRoles), asyncRoute(async (req, res) => paginated(res, resource.table, req, {
    columns: resource.columns,
    searchColumns: resource.searchColumns,
    sortFields: resource.sortFields
  })));
  app.get(`/api/${path}/:id`, requireAuth, requireRoles(...resource.readRoles), asyncRoute(async (req, res) => {
    const [rows] = await db.query<any[]>(
      `SELECT ${resource.columns ?? "*"} FROM ${resource.table} WHERE ${resource.idColumn}=? LIMIT 1`,
      [String(req.params.id)]
    );
    if (!rows[0]) return res.status(404).json({ message: "Record not found" });
    res.json(rows[0]);
  }));
  app.post(`/api/${path}`, requireAuth, requireRoles(...resource.writeRoles), asyncRoute(async (req, res) => {
    for (const field of resource.required) if (req.body[field] === undefined || req.body[field] === "") {
      return res.status(400).json({ message: `${field} is required` });
    }
    if (path === "shelters" && Number(req.body.currentOccupancy) > Number(req.body.capacity)) {
      return res.status(400).json({ message: "Current occupancy cannot exceed capacity" });
    }
    await validateResource(path, req.body);
    const entries = Object.entries(resource.fields).filter(([field]) => req.body[field] !== undefined);
    const recordId = randomUUID();
    const values = entries.map(([field]) => resource.jsonFields?.includes(field) ? JSON.stringify(req.body[field]) : req.body[field]);
    await db.execute(
      `INSERT INTO ${baseTable(resource.table)} (${resource.idColumn},${entries.map(([, column]) => column).join(",")}) VALUES (${entries.map(() => "?").concat("?").join(",")})`,
      [recordId, ...values]
    );
    res.status(201).json({ id: recordId });
  }));
  app.put(`/api/${path}/:id`, requireAuth, requireRoles(...resource.writeRoles), asyncRoute(async (req, res) => {
    if (path === "shelters" && req.body.currentOccupancy !== undefined && req.body.capacity !== undefined && Number(req.body.currentOccupancy) > Number(req.body.capacity)) {
      return res.status(400).json({ message: "Current occupancy cannot exceed capacity" });
    }
    await validateResource(path, req.body, String(req.params.id));
    const entries = Object.entries(resource.fields).filter(([field]) => req.body[field] !== undefined);
    if (!entries.length) return res.status(400).json({ message: "No supported fields supplied" });
    const values = entries.map(([field]) => resource.jsonFields?.includes(field) ? JSON.stringify(req.body[field]) : req.body[field]);
    const [result] = await db.execute<any>(
      `UPDATE ${baseTable(resource.table)} SET ${entries.map(([, column]) => `${column}=?`).join(",")} WHERE ${resource.idColumn}=?`,
      [...values, String(req.params.id)]
    );
    if (!result.affectedRows) {
      const [existing] = await db.query<any[]>(
        `SELECT ${resource.idColumn} FROM ${baseTable(resource.table)} WHERE ${resource.idColumn}=? LIMIT 1`,
        [String(req.params.id)]
      );
      if (!existing[0]) return res.status(404).json({ message: "Record not found" });
    }
    res.status(204).end();
  }));
}

for (const path of ["shelters", "volunteers", "evacuation-routes", "emergency-contacts"]) {
  const resource = resources[path]!;
  app.delete(`/api/${path}/:id`, requireAuth, requireRoles(...resource.writeRoles), asyncRoute(async (req, res) => {
    const recordId = String(req.params.id);
    if (path === "shelters") {
      const [references] = await db.query<any[]>(
        "SELECT COUNT(*) reference_count FROM evacuation_routes WHERE destination_shelter_id=?",
        [recordId]
      );
      if (Number(references[0]?.reference_count ?? 0) > 0) {
        return res.status(409).json({ message: "This shelter cannot be deleted while evacuation routes reference it" });
      }
    }
    const [result] = await db.execute<any>(
      `DELETE FROM ${baseTable(resource.table)} WHERE ${resource.idColumn}=?`,
      [recordId]
    );
    if (!result.affectedRows) return res.status(404).json({ message: "Evacuation support record not found" });
    res.status(204).end();
  }));
}

app.delete("/api/barangay-zones/:id", requireAuth, requireRoles("Super Admin"), asyncRoute(async (req, res) => {
  const zoneId = String(req.params.id);
  const [references] = await db.query<any[]>(`
    SELECT
      (SELECT COUNT(*) FROM households WHERE zone_id=?) +
      (SELECT COUNT(*) FROM shelters WHERE zone_id=?) +
      (SELECT COUNT(*) FROM volunteers WHERE assigned_zone_id=?) +
      (SELECT COUNT(*) FROM evacuation_routes WHERE origin_zone_id=?) +
      (SELECT COUNT(*) FROM flood_report_zones WHERE zone_id=?) +
      (SELECT COUNT(*) FROM notification_target_zones WHERE zone_id=?) AS reference_count
  `, [zoneId, zoneId, zoneId, zoneId, zoneId, zoneId]);
  if (Number(references[0]?.reference_count ?? 0) > 0) {
    return res.status(409).json({ message: "This zone cannot be deleted because households, map records, reports, or notifications still reference it" });
  }
  const [result] = await db.execute<any>("DELETE FROM zones WHERE zone_id=?", [zoneId]);
  if (!result.affectedRows) return res.status(404).json({ message: "Barangay zone not found" });
  res.status(204).end();
}));

app.delete("/api/risk-zones/:id", requireAuth, requireRoles("Super Admin"), asyncRoute(async (req, res) => {
  const [result] = await db.execute<any>("DELETE FROM risk_zones WHERE risk_zone_id=?", [String(req.params.id)]);
  if (!result.affectedRows) return res.status(404).json({ message: "Risk zone not found" });
  res.status(204).end();
}));

app.get("/api/dashboard/summary", requireAuth, asyncRoute(async (_req, res) => {
  const [rows] = await db.query<any[]>(`SELECT
    (SELECT COUNT(*) FROM residents) totalResidents,
    (SELECT COUNT(*) FROM households) totalHouseholds,
    (SELECT COUNT(*) FROM residents WHERE vulnerability_type IS NOT NULL) vulnerableResidents,
    (SELECT COUNT(*) FROM residents WHERE priority_level='High') highPriorityResidents,
    (SELECT COUNT(*) FROM zones) totalZones,
    (SELECT COUNT(*) FROM flood_reports WHERE status IN ('Submitted','Under Review','Validated')) activeReports,
    (SELECT COUNT(*) FROM flood_reports WHERE status IN ('Submitted','Under Review')) pendingReports`);
  res.json(rows[0]);
}));

app.get("/api/dashboard/recent-reports", requireAuth, asyncRoute(async (_req, res) => {
  const [items] = await db.query(
    `SELECT report_id,tracking_code,location_text,incident_type,description,severity_level,status,created_at
     FROM flood_reports ORDER BY created_at DESC LIMIT 5`
  );
  res.json({ items });
}));

app.get("/api/dashboard/alert", requireAuth, asyncRoute(async (_req, res) => {
  const [items] = await db.query<any[]>(`
    SELECT fr.report_id,fr.tracking_code,fr.location_text,fr.incident_type,fr.description,
      fr.severity_level,fr.status,fr.created_at,GROUP_CONCAT(DISTINCT z.zone_name ORDER BY z.zone_name SEPARATOR ', ') affected_zones
    FROM flood_reports fr
    LEFT JOIN flood_report_zones frz ON frz.report_id=fr.report_id
    LEFT JOIN zones z ON z.zone_id=frz.zone_id
    WHERE fr.status IN ('Submitted','Under Review','Validated')
    GROUP BY fr.report_id
    ORDER BY FIELD(fr.severity_level,'Major Incident','Minor Incident','Information'),fr.created_at DESC
    LIMIT 1
  `);
  res.json({ alert: items[0] ?? null });
}));

app.get("/api/dashboard/notifications", requireAuth, asyncRoute(async (_req, res) => {
  const [items] = await db.query(
    `SELECT notification_id,title,message,type,severity_level,target_audience,status,sent_at
     FROM notifications WHERE status='Sent' ORDER BY sent_at DESC LIMIT 5`
  );
  res.json({ items });
}));

const notificationInput = z.object({
  floodReportId: z.string().uuid().nullable().optional(),
  title: z.string().min(2).max(180),
  message: z.string().min(1),
  type: z.string().min(1).max(80),
  severityLevel: z.enum(["Information", "Minor Incident", "Major Incident"]),
  targetAudience: z.enum(["Public", "Affected Zones", "Internal Admin Users"]),
  zoneIds: z.array(z.string().uuid()).default([])
});

app.get("/api/notifications/public", asyncRoute(async (_req, res) => {
  const [items] = await db.query(
    `SELECT notification_id,flood_report_id,title,message,type,severity_level,target_audience,sent_at
     FROM notifications WHERE status='Sent' AND target_audience IN ('Public','Affected Zones')
     ORDER BY sent_at DESC LIMIT 20`
  );
  res.json({ items });
}));
app.get("/api/notifications", requireAuth, requireRoles("Super Admin", "Disaster Officer"), asyncRoute(async (req, res) =>
  paginated(res, "notifications", req, {
    columns: "notification_id,flood_report_id,title,message,type,severity_level,target_audience,delivery_channel,status,sent_by_user_id,sent_at,created_at,updated_at",
    searchColumns: ["title", "message", "type"],
    sortFields: ["title", "type", "severity_level", "target_audience", "status", "sent_at", "created_at", "updated_at"]
  })
));
app.post("/api/notifications", requireAuth, requireRoles("Super Admin", "Disaster Officer"), asyncRoute(async (req, res) => {
  const input = notificationInput.parse(req.body);
  if (input.targetAudience === "Affected Zones" && !input.zoneIds.length) return res.status(400).json({ message: "Affected Zones notifications require at least one zone" });
  const id = randomUUID();
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute(
      "INSERT INTO notifications(notification_id,flood_report_id,title,message,type,severity_level,target_audience) VALUES(?,?,?,?,?,?,?)",
      [id, input.floodReportId ?? null, input.title, input.message, input.type, input.severityLevel, input.targetAudience]
    );
    for (const zoneId of input.zoneIds) await connection.execute("INSERT INTO notification_target_zones(notification_id,zone_id) VALUES(?,?)", [id, zoneId]);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally { connection.release(); }
  res.status(201).json({ notificationId: id });
}));
app.put("/api/notifications/:id", requireAuth, requireRoles("Super Admin", "Disaster Officer"), asyncRoute(async (req, res) => {
  const input = notificationInput.parse(req.body);
  const [existing] = await db.query<any[]>("SELECT status FROM notifications WHERE notification_id=?", [String(req.params.id)]);
  if (!existing[0]) return res.status(404).json({ message: "Notification not found" });
  if (existing[0].status !== "Draft") return res.status(409).json({ message: "Only draft notifications can be edited" });
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute(
      "UPDATE notifications SET flood_report_id=?,title=?,message=?,type=?,severity_level=?,target_audience=? WHERE notification_id=?",
      [input.floodReportId ?? null, input.title, input.message, input.type, input.severityLevel, input.targetAudience, String(req.params.id)]
    );
    await connection.execute("DELETE FROM notification_target_zones WHERE notification_id=?", [String(req.params.id)]);
    for (const zoneId of input.zoneIds) await connection.execute("INSERT INTO notification_target_zones(notification_id,zone_id) VALUES(?,?)", [String(req.params.id), zoneId]);
    await connection.commit();
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  res.status(204).end();
}));
app.post("/api/notifications/:id/send", requireAuth, requireRoles("Super Admin", "Disaster Officer"), asyncRoute(async (req: AuthRequest, res) => {
  const [result] = await db.execute<any>(
    "UPDATE notifications SET status='Sent',sent_by_user_id=?,sent_at=NOW() WHERE notification_id=? AND status='Draft'",
    [req.user!.userId, String(req.params.id)]
  );
  if (!result.affectedRows) return res.status(409).json({ message: "Only an existing draft notification can be sent" });
  res.status(204).end();
}));
app.post("/api/notifications/:id/archive", requireAuth, requireRoles("Super Admin", "Disaster Officer"), asyncRoute(async (req, res) => {
  const [result] = await db.execute<any>("UPDATE notifications SET status='Archived' WHERE notification_id=? AND status!='Archived'", [String(req.params.id)]);
  if (!result.affectedRows) return res.status(404).json({ message: "Active notification not found" });
  res.status(204).end();
}));
app.put("/api/notifications/:id/read-status", requireAuth, asyncRoute(async (req: AuthRequest, res) => {
  const { isRead } = z.object({ isRead: z.boolean() }).parse(req.body);
  if (isRead) {
    await db.execute(
      "INSERT INTO notification_read_receipts(notification_id,user_id,read_at) VALUES(?,?,NOW()) ON DUPLICATE KEY UPDATE read_at=NOW()",
      [String(req.params.id), req.user!.userId]
    );
  } else {
    await db.execute("DELETE FROM notification_read_receipts WHERE notification_id=? AND user_id=?", [String(req.params.id), req.user!.userId]);
  }
  res.status(204).end();
}));

app.get("/api/statistics/risk-summary", requireAuth, asyncRoute(async (_req, res) => {
  const [rows] = await db.query<any[]>(`
    SELECT CASE
      WHEN SUM(CASE WHEN fr.severity_level='Major Incident' OR rz.risk_level='High' THEN 1 ELSE 0 END)>0 THEN 'High'
      WHEN SUM(CASE WHEN fr.severity_level='Minor Incident' OR rz.risk_level='Medium' THEN 1 ELSE 0 END)>0 THEN 'Medium'
      ELSE 'Low' END overallRiskLevel,
      COUNT(DISTINCT fr.report_id) activeValidatedReports,
      COUNT(DISTINCT frz.zone_id) affectedZones
    FROM flood_reports fr
    LEFT JOIN flood_report_zones frz ON frz.report_id=fr.report_id
    LEFT JOIN risk_zones rz ON ST_Intersects(
      ST_GeomFromGeoJSON(rz.polygon_geojson),
      ST_SRID(POINT(fr.longitude, fr.latitude),4326)
    )
    WHERE fr.status='Validated'`);
  res.json(rows[0]);
}));
app.get("/api/statistics/zone-breakdown", requireAuth, asyncRoute(async (_req, res) => {
  const [items] = await db.query(`
    SELECT z.zone_id,z.zone_name,
      CASE
        WHEN SUM(rz.risk_level='High')>0 THEN 'High'
        WHEN SUM(rz.risk_level='Medium')>0 THEN 'Medium'
        ELSE 'Low'
      END risk_level,
      COUNT(DISTINCT fr.report_id) active_reports,
      COUNT(DISTINCT CASE WHEN fr.report_id IS NOT NULL THEN r.resident_id END) affected_residents
    FROM zones z
    LEFT JOIN risk_zones rz ON ST_Intersects(
      ST_GeomFromGeoJSON(z.polygon_geojson),
      ST_GeomFromGeoJSON(rz.polygon_geojson)
    )
    LEFT JOIN flood_report_zones frz ON frz.zone_id=z.zone_id
    LEFT JOIN flood_reports fr ON fr.report_id=frz.report_id AND fr.status='Validated'
    LEFT JOIN households h ON h.zone_id=z.zone_id
    LEFT JOIN residents r ON r.household_id=h.household_id
    GROUP BY z.zone_id,z.zone_name,z.risk_level ORDER BY FIELD(z.risk_level,'High','Medium','Low')`);
  res.json({ items });
}));
app.get("/api/statistics/evacuation-priorities", requireAuth, asyncRoute(async (_req, res) => {
  const [items] = await db.query(`
    SELECT DISTINCT r.resident_id,r.full_name,r.vulnerability_type,r.priority_level,r.evacuation_status,
      h.address_line,z.zone_name
    FROM residents r JOIN households h ON h.household_id=r.household_id JOIN zones z ON z.zone_id=h.zone_id
    JOIN flood_report_zones frz ON frz.zone_id=z.zone_id JOIN flood_reports fr ON fr.report_id=frz.report_id
    WHERE fr.status='Validated' AND (r.vulnerability_type IS NOT NULL OR r.priority_level='High')
    ORDER BY FIELD(r.priority_level,'High','Medium','Low'),r.full_name`);
  res.json({ items });
}));

app.use(async (error: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (files.length) await Promise.all(files.map((file) => unlink(file.path).catch(() => undefined)));
  const status =
    error instanceof z.ZodError ? 400 :
    ["LIMIT_FILE_SIZE", "LIMIT_FILE_COUNT"].includes(error?.code) ? 413 :
    error?.code === "ER_DUP_ENTRY" ? 409 :
    error?.code === "ER_NO_REFERENCED_ROW_2" ? 400 :
    ["JsonWebTokenError", "TokenExpiredError"].includes(error?.name) ? 401 : 500;
  res.status(status).json({ message: status === 500 ? "Unexpected server error" : error.message, issues: error.issues });
});

app.listen(config.port, () => console.log(`BantayBaha API listening on http://localhost:${config.port}`));
