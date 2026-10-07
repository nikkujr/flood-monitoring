import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { readFile, unlink } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";
import bcrypt from "bcryptjs";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import multer from "multer";
import nodemailer from "nodemailer";
import { z } from "zod";
import { config } from "./config.js";
import { db, healthcheck } from "./db.js";
import { loadDss } from "./dss-api.js";
import { criticalZoneStatus, zoneStatusInput } from './dss-zone-status.js';
import { vulnerabilities } from "./dss.js";
import { reportReviewInput, reportTransitions } from "./report-review.js";
import { parseResidentCsv, residentImportSchema } from "./resident-import.js";
import {residentReadiness,residentQualityConditions,reportMissingZone} from './record-readiness.js';
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
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "https://maps.googleapis.com", "https://maps.gstatic.com"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:", "https://tile.openstreetmap.org", "https://*.tile.openstreetmap.org", "https://server.arcgisonline.com", "https://maps.gstatic.com", "https://*.google.com", "https://*.googleapis.com"],
      connectSrc: ["'self'", "https://ulap-nga.georisk.gov.ph", "https://maps.googleapis.com"],
      fontSrc: ["'self'", "data:", "https://fonts.gstatic.com"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'self'"]
    }
  }
}));
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
  options: { columns?: string; where?: string; params?: unknown[]; searchColumns?: string[]; sortFields?: string[]; defaultSort?: string; filterFields?: Record<string, { column?: string; sql?: string; exact?: boolean; present?: boolean; operator?: ">=" | "<=" }> } = {}
) {
  const { page, pageSize, offset } = pagination(req);
  const search = String(req.query.search ?? "").trim();
  const params = [...(options.params ?? [])];
  let where = options.where ?? "1=1";
  if (search && options.searchColumns?.length) {
    where += ` AND (${options.searchColumns.map((column) => `${column} LIKE ?`).join(" OR ")})`;
    params.push(...options.searchColumns.map(() => `%${search}%`));
  }
  for (const [name, filter] of Object.entries(options.filterFields ?? {})) {
    const value = String(req.query[`filter_${name}`] ?? "").trim();
    if (!value) continue;
    const expression = filter.sql ?? filter.column;
    if (!expression) continue;
    if (filter.present) {
      where += ` AND ${expression} IS NOT NULL AND TRIM(${expression})!=''`;
      continue;
    }
    if (filter.sql) where += ` AND ${filter.sql}`;
    else if (filter.operator) where += ` AND ${expression}${filter.operator}?`;
    else where += filter.exact ? ` AND ${expression}=?` : ` AND ${expression} LIKE ?`;
    params.push(filter.exact || filter.operator || filter.sql ? value : `%${value}%`);
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

// frontend
app.post("/api/auth/login", asyncRoute(async (req, res) => {
  // once receive the req, extract u and p (condition)
  const input = z.object({
    username: z.string({ error: "Username is required." }).trim().min(1, "Username is required."),
    password: z.string({ error: "Password is required." }).min(1, "Password is required.")
  }).parse(req.body);
  const [rows] = await db.execute<any[]>("SELECT * FROM users WHERE username=? AND is_active=1 LIMIT 1", [input.username]);
  const row = rows[0];
  if (!row || !(await bcrypt.compare(input.password, row.password_hash))) {
    return res.status(401).json({ message: "Invalid username or password" });
  }
  const user: AuthUser = { userId: row.user_id, username: row.username, role: row.role, credentialVersion: row.credential_version };
  const refreshToken = await createRefreshToken(user);
  await db.execute("UPDATE users SET last_login_at=NOW() WHERE user_id=?", [user.userId]);
  res.cookie("refreshToken", refreshToken, refreshCookie);
  res.json({ accessToken: createAccessToken(user), user: { ...user, fullName: row.full_name, email: row.email, mustChangePassword: Boolean(row.must_change_password) } });
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
    "SELECT user_id userId,full_name fullName,username,email,role,is_active isActive,must_change_password mustChangePassword,last_login_at lastLoginAt FROM users WHERE user_id=?",
    [req.user!.userId]
  );
  res.json(rows[0]);
}));

const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
async function issuePasswordReset(userId: string, email: string) {
  if (!config.smtpHost && config.isProduction) throw new Error("Password recovery email is not configured");
  const token = randomBytes(32).toString("hex");
  const id = randomUUID();
  await db.execute(
    "INSERT INTO password_reset_tokens(password_reset_token_id,user_id,token_hash,expires_at) VALUES(?,?,?,DATE_ADD(NOW(),INTERVAL 30 MINUTE))",
    [id, userId, tokenHash(token)]
  );
  if (config.smtpHost) {
    const transport = nodemailer.createTransport({
      host: config.smtpHost, port: config.smtpPort, secure: config.smtpSecure,
      auth: config.smtpUser ? { user: config.smtpUser, pass: config.smtpPassword } : undefined
    });
    try {
      await transport.sendMail({
        from: config.smtpFrom, to: email, subject: "Reset your BantayBaha password",
        text: `Reset your password within 30 minutes: ${config.passwordResetUrl}?token=${token}`
      });
    } catch (error) {
      await db.execute("DELETE FROM password_reset_tokens WHERE password_reset_token_id=?", [id]);
      throw error;
    }
  } else if (!config.isProduction) {
    console.info(`Development password reset URL: ${config.passwordResetUrl}?token=${token}`);
  } else {
    throw new Error("Password recovery email is not configured");
  }
}

app.post("/api/auth/forgot-password", asyncRoute(async (req, res) => {
  const { email } = z.object({ email: z.string({ error: "Email address is required." }).trim().email("Enter a valid email address.") }).parse(req.body);
  const [rows] = await db.execute<any[]>("SELECT user_id,email FROM users WHERE email=? AND is_active=1 LIMIT 1", [email]);
  if (rows[0]) {
    try { await issuePasswordReset(rows[0].user_id, rows[0].email); }
    catch (error) { console.error("Password recovery delivery failed:", error instanceof Error ? error.message : "Unknown error"); }
  }
  res.status(202).json({ message: "If an active account exists, password-reset instructions will be sent." });
}));

app.post("/api/auth/reset-password", asyncRoute(async (req, res) => {
  const input = z.object({
    token: z.string().min(32),
    password: z.string().min(12, "Password must contain at least 12 characters.").regex(/[A-Z]/, "Password must include an uppercase letter.").regex(/[a-z]/, "Password must include a lowercase letter.").regex(/\d/, "Password must include a number.")
  }).parse(req.body);
  const [rows] = await db.execute<any[]>(
    "SELECT password_reset_token_id,user_id FROM password_reset_tokens WHERE token_hash=? AND used_at IS NULL AND expires_at>NOW() LIMIT 1",
    [tokenHash(input.token)]
  );
  if (!rows[0]) return res.status(400).json({ message: "Reset token is invalid or expired" });
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute("UPDATE users SET password_hash=?,must_change_password=0,credential_version=credential_version+1 WHERE user_id=?", [await bcrypt.hash(input.password, 12), rows[0].user_id]);
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

app.post("/api/auth/change-password", requireAuth, asyncRoute(async (req: AuthRequest, res) => {
  const input = z.object({
    currentPassword: z.string().min(1, "Current password is required."),
    newPassword: z.string().min(12, "New password must contain at least 12 characters.").regex(/[A-Z]/, "New password must include an uppercase letter.").regex(/[a-z]/, "New password must include a lowercase letter.").regex(/\d/, "New password must include a number.")
  }).parse(req.body);
  const [rows] = await db.execute<any[]>("SELECT password_hash,username,role,full_name,email,credential_version FROM users WHERE user_id=? AND is_active=1", [req.user!.userId]);
  const row = rows[0];
  if (!row || !(await bcrypt.compare(input.currentPassword, row.password_hash))) {
    return res.status(400).json({ message: "Current password is incorrect.", fieldErrors: { currentPassword: "Current password is incorrect." } });
  }
  if (input.currentPassword === input.newPassword) {
    return res.status(400).json({ message: "Choose a different new password.", fieldErrors: { newPassword: "Choose a different new password." } });
  }
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute("UPDATE users SET password_hash=?,must_change_password=0,credential_version=credential_version+1 WHERE user_id=?", [await bcrypt.hash(input.newPassword, 12), req.user!.userId]);
    await connection.execute("UPDATE refresh_tokens SET revoked_at=NOW() WHERE user_id=? AND revoked_at IS NULL", [req.user!.userId]);
    await connection.commit();
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  const user: AuthUser = { userId: req.user!.userId, username: row.username, role: row.role, credentialVersion: row.credential_version + 1 };
  const refreshToken = await createRefreshToken(user);
  res.cookie("refreshToken", refreshToken, refreshCookie);
  res.json({ accessToken: createAccessToken(user), user: { ...user, fullName: row.full_name, email: row.email, mustChangePassword: false } });
}));

const userInput = z.object({
  fullName: z.string().trim().min(2),
  username: z.string().trim().min(3),
  email: z.string().trim().toLowerCase().email(),
  role: z.enum(["Super Admin", "Disaster Officer", "Data Encoder"]),
  password: z.string().min(12, "Password must contain at least 12 characters.").regex(/[A-Z]/, "Password must include an uppercase letter.").regex(/[a-z]/, "Password must include a lowercase letter.").regex(/\d/, "Password must include a number.").optional()
});

async function ensureUniqueUserIdentity(username: string, email: string, excludedUserId?: string) {
  const params: string[] = [username, email];
  let sql = "SELECT user_id,username,email FROM users WHERE (LOWER(username)=LOWER(?) OR LOWER(email)=LOWER(?))";
  if (excludedUserId) {
    sql += " AND user_id<>?";
    params.push(excludedUserId);
  }
  sql += " LIMIT 1";
  const [rows] = await db.execute<any[]>(sql, params);
  const duplicate = rows[0];
  if (!duplicate) return;
  const field = String(duplicate.username).toLowerCase() === username.toLowerCase() ? "username" : "email";
  throw new z.ZodError([{ code: "custom", path: [field], message: `That ${field} is already used by another account` }]);
}

app.get("/api/users", requireAuth, requireRoles("Super Admin"), asyncRoute(async (req, res) => paginated(res, "users", req, {
  columns: "user_id,full_name,username,email,role,is_active,last_login_at,created_at,updated_at",
  searchColumns: ["full_name", "username", "email"],
  sortFields: ["full_name", "username", "email", "role", "is_active", "last_login_at", "created_at"]
})));
app.post("/api/users", requireAuth, requireRoles("Super Admin"), asyncRoute(async (req, res) => {
  const input = userInput.extend({ password: userInput.shape.password.unwrap() }).parse(req.body);
  await ensureUniqueUserIdentity(input.username, input.email);
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
  const input = userInput.parse(req.body);
  const userId = String(req.params.id);
  await ensureUniqueUserIdentity(input.username, input.email, userId);
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    if (input.password) {
      await connection.execute(
        "UPDATE users SET full_name=?,username=?,email=?,role=?,password_hash=?,must_change_password=0,credential_version=credential_version+1 WHERE user_id=?",
        [input.fullName, input.username, input.email, input.role, await bcrypt.hash(input.password, 12), userId]
      );
      await connection.execute("UPDATE refresh_tokens SET revoked_at=NOW() WHERE user_id=? AND revoked_at IS NULL", [userId]);
      await connection.execute("UPDATE password_reset_tokens SET used_at=NOW() WHERE user_id=? AND used_at IS NULL", [userId]);
    } else {
      await connection.execute("UPDATE users SET full_name=?,username=?,email=?,role=? WHERE user_id=?", [input.fullName, input.username, input.email, input.role, userId]);
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
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
  if (config.isProduction && !config.smtpHost) return res.status(503).json({ message: "Email delivery is not configured. Generate a temporary password or configure SMTP." });
  try {
    await issuePasswordReset(rows[0].user_id, rows[0].email);
  } catch {
    return res.status(502).json({ message: "Email delivery failed. Check the SMTP settings or generate a temporary password." });
  }
  res.status(202).json({ message: config.smtpHost ? `A reset link was sent to ${rows[0].email}.` : "Development reset link was written to the API log; no email was sent." });
}));
app.post("/api/users/:id/temporary-password", requireAuth, requireRoles("Super Admin"), asyncRoute(async (req, res) => {
  const id = String(req.params.id);
  const [rows] = await db.execute<any[]>("SELECT user_id FROM users WHERE user_id=? AND is_active=1", [id]);
  if (!rows[0]) return res.status(404).json({ message: "Active user account not found" });
  const temporaryPassword = `T7a!${randomBytes(18).toString("base64url")}`;
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute("UPDATE users SET password_hash=?,must_change_password=1,credential_version=credential_version+1 WHERE user_id=?", [await bcrypt.hash(temporaryPassword, 12), id]);
    await connection.execute("UPDATE refresh_tokens SET revoked_at=NOW() WHERE user_id=? AND revoked_at IS NULL", [id]);
    await connection.execute("UPDATE password_reset_tokens SET used_at=NOW() WHERE user_id=? AND used_at IS NULL", [id]);
    await connection.commit();
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  res.set("Cache-Control", "no-store").json({ temporaryPassword });
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

function pointInsideRing(latitude: number, longitude: number, ring: number[][]) {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const [x = 0, y = 0] = ring[index] ?? [];
    const [previousX = 0, previousY = 0] = ring[previous] ?? [];
    if (((y > latitude) !== (previousY > latitude)) && longitude < (previousX - x) * (latitude - y) / (previousY - y) + x) inside = !inside;
  }
  return inside;
}

function pointInsideGeometry(latitude: number, longitude: number, value: unknown) {
  try {
    const geometry = typeof value === "string" ? JSON.parse(value) : value as any;
    const polygons = geometry?.type === "Polygon" ? [geometry.coordinates] : geometry?.type === "MultiPolygon" ? geometry.coordinates : [];
    return polygons.some((polygon: number[][][]) =>
      pointInsideRing(latitude, longitude, polygon[0] ?? [])
      && !polygon.slice(1).some((hole) => pointInsideRing(latitude, longitude, hole))
    );
  } catch {
    return false;
  }
}

app.post("/api/flood-reports", uploads.array("photos", 5), asyncRoute(async (req, res) => {
  const input = z.object({
    reporterName: z.string().optional(),
    reporterContactInfo: z.string().optional(),
    locationText: z.string().min(2),
    incidentType: z.enum(["River Flooding", "Flash Flood", "Road Flooding", "Drainage Overflow", "Rising Water", "Other"]),
    severityLevel: z.enum(["Information", "Minor Incident", "Major Incident"]),
    latitude: z.coerce.number().min(-90).max(90),
    longitude: z.coerce.number().min(-180).max(180),
    description: z.string().trim().max(2000).optional().default("")
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
  const [zones] = await db.query<any[]>("SELECT zone_id,zone_name,polygon_geojson FROM zones WHERE polygon_geojson IS NOT NULL");
  const zone = zones.find((candidate) => pointInsideGeometry(input.latitude, input.longitude, candidate.polygon_geojson));
  if (zones.length && !zone) {
    await Promise.all(uploadedFiles.map((uploaded) => unlink(uploaded.path).catch(() => undefined)));
    return res.status(400).json({ message: "The pinned location does not fall inside a configured barangay zone." });
  }
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute(
      "INSERT INTO flood_reports(report_id,tracking_code,reporter_name,reporter_contact_info,location_text,incident_type,latitude,longitude,description,photo_urls,severity_level) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
      [id, trackingCode, input.reporterName ?? null, input.reporterContactInfo ?? null, input.locationText, input.incidentType, input.latitude, input.longitude, input.description, JSON.stringify(photos), input.severityLevel]
    );
    if (zone) await connection.execute("INSERT INTO flood_report_zones(report_id,zone_id) VALUES(?,?)", [id, zone.zone_id]);
    if (zone) await syncAutomaticRiskZones(connection, [String(zone.zone_id)]);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  res.status(201).json({ reportId: id, trackingCode, status: "Submitted", zoneId: zone?.zone_id ?? null, zoneName: zone?.zone_name ?? null });
}));

app.get("/api/flood-reports/public", asyncRoute(async (req, res) => paginated(res, "flood_reports", req, {
  columns: "report_id,tracking_code,location_text,incident_type,latitude,longitude,description,photo_urls,severity_level,status,validated_at,created_at,updated_at",
  where: "status='Validated'",
  searchColumns: ["tracking_code", "location_text", "description"],
  sortFields: ["created_at", "validated_at", "severity_level", "location_text"]
})));
app.get("/api/flood-reports", requireAuth, requireRoles("Super Admin", "Disaster Officer"), asyncRoute(async (req, res) => paginated(res, "flood_reports", req, {
  searchColumns: ["tracking_code", "reporter_name", "location_text", "description", "status"],
  sortFields: ["created_at", "updated_at", "severity_level", "status", "location_text"],
  filterFields: {
    zone: { sql: "EXISTS(SELECT 1 FROM flood_report_zones frz WHERE frz.report_id=flood_reports.report_id AND frz.zone_id=?)", exact: true },
    severity: { column: "severity_level", exact: true }, status: { column: "status", exact: true },
    pending: { sql: "status IN ('Submitted','Under Review') AND ?='true'", exact: true },
    missingZone: {sql: `${reportMissingZone} AND ?='true'`,exact:true},
    incidentType: { column: "incident_type", exact: true }, dateFrom: { column: "created_at", operator: ">=" },
    dateTo: { sql: "created_at<DATE_ADD(?, INTERVAL 1 DAY)", exact: true }
  }
})));
app.get("/api/flood-reports/pending-count", requireAuth, requireRoles("Super Admin", "Disaster Officer"), asyncRoute(async (_req, res) => {
  const [rows] = await db.query<any[]>("SELECT COUNT(*) pendingCount FROM flood_reports WHERE status IN ('Submitted','Under Review')");
  res.json({ pendingCount: Number(rows[0]?.pendingCount ?? 0) });
}));
app.get("/api/flood-reports/:id", requireAuth, requireRoles("Super Admin", "Disaster Officer"), asyncRoute(async (req, res) => {
  const [rows] = await db.query<any[]>(
    "SELECT * FROM flood_reports WHERE report_id=? LIMIT 1",
    [String(req.params.id)]
  );
  if (!rows[0]) return res.status(404).json({ message: "Flood report not found" });
  const [zones] = await db.query<any[]>(
    "SELECT zone_id FROM flood_report_zones WHERE report_id=? ORDER BY zone_id",
    [String(req.params.id)]
  );
  const [reviews] = await db.query<any[]>("SELECT review_id,from_status,to_status,severity_level,notes,affected_zones,reviewer_name,created_at FROM flood_report_reviews WHERE report_id=? ORDER BY created_at,review_id", [String(req.params.id)]);
  res.json({ ...rows[0], affected_zone_ids: zones.map((zone) => zone.zone_id), allowed_statuses:reportTransitions[rows[0].status] ?? [], reviews:reviews.map(review=>({...review,affected_zones:typeof review.affected_zones==='string'?JSON.parse(review.affected_zones):review.affected_zones})) });
}));

async function serveReportPhoto(reportId: string, indexValue: string, publicOnly: boolean, res: express.Response) {
  const [rows] = await db.query<any[]>(
    `SELECT photo_urls,status FROM flood_reports WHERE report_id=? ${publicOnly ? "AND status='Validated'" : ""} LIMIT 1`,
    [reportId]
  );
  if (!rows[0]) return res.status(404).json({ message: "Flood report not found" });
  const index = Number(indexValue);
  if (!Number.isSafeInteger(index) || index < 0) return res.status(400).json({ message: "Invalid photo index" });
  let photoUrls: unknown;
  try {
    photoUrls = typeof rows[0].photo_urls === "string" ? JSON.parse(rows[0].photo_urls) : rows[0].photo_urls;
  } catch {
    return res.status(404).json({ message: "Photo not found" });
  }
  const storedPath = Array.isArray(photoUrls) ? photoUrls[index] : undefined;
  if (typeof storedPath !== "string" || !storedPath.trim()) return res.status(404).json({ message: "Photo not found" });
  // Accept both legacy "/flood-reports/..." paths and newer relative paths.
  const normalizedPath = storedPath.replace(/^[\\/]+/, "");
  const absolutePath = resolve(config.uploadRoot, normalizedPath);
  const pathFromUploadRoot = relative(config.uploadRoot, absolutePath);
  if (!pathFromUploadRoot || pathFromUploadRoot.startsWith("..") || resolve(config.uploadRoot, pathFromUploadRoot) !== absolutePath) {
    return res.status(400).json({ message: "Invalid photo path" });
  }
  res.sendFile(absolutePath);
}

async function syncAutomaticRiskZones(connection: any, zoneIds: string[]) {
  for (const zoneId of [...new Set(zoneIds)]) {
    const [sourceRows] = await connection.query(
      "SELECT zone_name FROM zones WHERE zone_id=? LIMIT 1",
      [zoneId]
    );
    const sourceZone = sourceRows[0];
    if (!sourceZone) continue;

    // Zone records imported at different times can have names such as "Zone 4"
    // and "Zone 4 - South Fields". Treat them as aliases so their validated
    // reports contribute to the same automatic risk zone.
    const zoneNumber = String(sourceZone.zone_name).match(/^zone\s*(\d+)/i)?.[1];
    const [aliases] = zoneNumber
      ? await connection.query(
          `SELECT zone_id,zone_name,polygon_geojson
           FROM zones
           WHERE LOWER(TRIM(zone_name)) REGEXP ?
           ORDER BY CHAR_LENGTH(zone_name) DESC,created_at DESC`,
          [`^zone[[:space:]]*${zoneNumber}([^0-9]|$)`]
        )
      : await connection.query(
          `SELECT zone_id,zone_name,polygon_geojson
           FROM zones
           WHERE LOWER(TRIM(zone_name))=LOWER(TRIM(?))
           ORDER BY CHAR_LENGTH(zone_name) DESC,created_at DESC`,
          [sourceZone.zone_name]
        );
    if (!aliases.length) continue;

    const canonicalZone = aliases[0];
    const aliasIds = aliases.map((zone: any) => String(zone.zone_id));
    const [counts] = await connection.query(
      `SELECT COUNT(DISTINCT fr.report_id) report_count,
        COALESCE(MAX(fr.severity_level='Major Incident'),0) major_count
       FROM flood_report_zones frz
       JOIN flood_reports fr ON fr.report_id=frz.report_id AND fr.status='Validated'
       WHERE frz.zone_id IN (?)`,
      [aliasIds]
    );
    const automaticName = `Automatic Flood Risk - ${canonicalZone.zone_name}`;
    const aliasNames = aliases.map((zone: any) => `Automatic Flood Risk - ${zone.zone_name}`);
    await connection.query(
      "DELETE FROM risk_zones WHERE risk_zone_name IN (?) AND risk_zone_name<>?",
      [aliasNames, automaticName]
    );
    const reportCount = Number(counts[0]?.report_count ?? 0);
    if (reportCount < 3) {
      await connection.execute("DELETE FROM risk_zones WHERE risk_zone_name=?", [automaticName]);
      continue;
    }
    const riskLevel = reportCount >= 5 || Number(counts[0]?.major_count ?? 0) > 0 ? "High" : "Medium";
    const description = `Automatically generated from ${reportCount} validated flood reports in ${canonicalZone.zone_name}.`;
    await connection.execute(
      `INSERT INTO risk_zones(risk_zone_id,risk_zone_name,risk_level,polygon_geojson,description)
       VALUES(?,?,?,?,?)
       ON DUPLICATE KEY UPDATE risk_level=VALUES(risk_level),polygon_geojson=VALUES(polygon_geojson),description=VALUES(description)`,
      [randomUUID(), automaticName, riskLevel, canonicalZone.polygon_geojson, description]
    );
  }
}

app.get("/api/flood-reports/public/:id/photos/:index", asyncRoute(async (req, res) =>
  serveReportPhoto(String(req.params.id), String(req.params.index), true, res)
));

app.get("/api/flood-reports/:id/photos/:index", requireAuth, requireRoles("Super Admin", "Disaster Officer"), asyncRoute(async (req, res) =>
  serveReportPhoto(String(req.params.id), String(req.params.index), false, res)
));
app.put("/api/flood-reports/:id/status", requireAuth, requireRoles("Super Admin", "Disaster Officer"), asyncRoute(async (req: AuthRequest, res) => {
  const input = reportReviewInput.parse(req.body);
  const uniqueZoneIds = [...new Set(input.zoneIds)];
  const [zones] = uniqueZoneIds.length ? await db.query<any[]>("SELECT zone_id,zone_name FROM zones WHERE zone_id IN (?)", [uniqueZoneIds]) : [[]];
  if (zones.length !== uniqueZoneIds.length) return res.status(400).json({ message: "One or more selected Barangay Zones do not exist" });
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [reports] = await connection.query<any[]>("SELECT status FROM flood_reports WHERE report_id=? FOR UPDATE", [String(req.params.id)]);
    if (!reports[0] || reports[0].status !== input.expectedStatus) {
      await connection.rollback();
      return res.status(reports[0] ? 409 : 404).json({message:reports[0] ? "This report changed since you opened it. Close and reopen the review to load its current status." : "Flood report not found"});
    }
    const [previousZones] = await connection.query<any[]>("SELECT zone_id FROM flood_report_zones WHERE report_id=?", [String(req.params.id)]);
    await connection.execute(
      "UPDATE flood_reports SET status=?,severity_level=?,validation_notes=?,validated_by_user_id=IF(?='Validated' AND ?!='Validated',?,validated_by_user_id),validated_at=IF(?='Validated' AND ?!='Validated',NOW(),validated_at) WHERE report_id=?",
      [input.status, input.severityLevel, input.validationNotes, input.status, input.expectedStatus, req.user!.userId, input.status, input.expectedStatus, String(req.params.id)]
    );
    const [reviewInsert] = await connection.execute<any>("INSERT INTO flood_report_reviews(report_id,from_status,to_status,severity_level,notes,affected_zones,reviewer_user_id,reviewer_name) SELECT ?,?,?,?,?,?,?,full_name FROM users WHERE user_id=?", [String(req.params.id),input.expectedStatus,input.status,input.severityLevel,input.validationNotes,JSON.stringify(zones.map(zone=>zone.zone_name)),req.user!.userId,req.user!.userId]);
    if (reviewInsert.affectedRows !== 1) throw new Error("The reviewer account is no longer available. Reopen this report before trying again.");
    await connection.execute("DELETE FROM flood_report_zones WHERE report_id=?", [String(req.params.id)]);
    for (const zoneId of uniqueZoneIds) await connection.execute("INSERT INTO flood_report_zones(report_id,zone_id) VALUES(?,?)", [String(req.params.id), zoneId]);
    await syncAutomaticRiskZones(connection, [...previousZones.map((zone) => String(zone.zone_id)), ...uniqueZoneIds]);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  res.status(204).end();
}));

app.delete("/api/flood-reports/:id", requireAuth, requireRoles("Super Admin"), asyncRoute(async (req, res) => {
  const reportId = String(req.params.id);
  const connection = await db.getConnection();
  let photoUrls: unknown;
  try {
    await connection.beginTransaction();
    const [reports] = await connection.query<any[]>("SELECT photo_urls FROM flood_reports WHERE report_id=? FOR UPDATE", [reportId]);
    if (!reports[0]) {
      await connection.rollback();
      return res.status(404).json({ message: "Flood report not found" });
    }
    photoUrls = reports[0].photo_urls;
    const [affectedZones] = await connection.query<any[]>("SELECT zone_id FROM flood_report_zones WHERE report_id=?", [reportId]);
    await connection.execute("UPDATE notifications SET flood_report_id=NULL WHERE flood_report_id=?", [reportId]);
    await connection.execute("DELETE FROM flood_report_zones WHERE report_id=?", [reportId]);
    await connection.execute("DELETE FROM flood_reports WHERE report_id=?", [reportId]);
    await syncAutomaticRiskZones(connection, affectedZones.map((zone) => String(zone.zone_id)));
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  try {
    const files = typeof photoUrls === "string" ? JSON.parse(photoUrls) : photoUrls;
    if (Array.isArray(files)) await Promise.all(files.map(async (storedPath) => {
      if (typeof storedPath !== "string") return;
      const absolutePath = resolve(config.uploadRoot, storedPath.replaceAll("\\", "/").replace(/^\/+/, ""));
      if (!relative(config.uploadRoot, absolutePath).replaceAll("\\", "/").startsWith("flood-reports/")) return;
      await unlink(absolutePath).catch(() => undefined);
    }));
  } catch {
    // A malformed legacy photo list must not undo the committed report deletion.
  }
  res.status(204).end();
}));

app.get("/api/map/live", asyncRoute(async (_req, res) => {
  const [[zones], [riskZones], [shelters], [reports], [routes]] = await Promise.all([
    db.query(`SELECT z.*,
      COUNT(DISTINCT fr.report_id) active_report_count,
      CASE
        WHEN COUNT(DISTINCT fr.report_id)>=5 THEN 'Critical'
        WHEN COUNT(DISTINCT fr.report_id)>=3 OR SUM(fr.severity_level='Major Incident')>0 THEN 'High'
        WHEN COUNT(DISTINCT fr.report_id)>0 THEN 'Moderate'
        ELSE 'Low'
      END assessed_risk_level
      FROM zones z
      LEFT JOIN flood_report_zones frz ON frz.zone_id=z.zone_id
      LEFT JOIN flood_reports fr ON fr.report_id=frz.report_id AND fr.status='Validated'
      GROUP BY z.zone_id`),
    db.query(`WITH zone_aliases AS (
        SELECT z.*,
          COALESCE(LOWER(REGEXP_SUBSTR(TRIM(z.zone_name),'^zone[[:space:]]*[0-9]+')),LOWER(TRIM(z.zone_name))) zone_key,
          ROW_NUMBER() OVER (
            PARTITION BY COALESCE(LOWER(REGEXP_SUBSTR(TRIM(z.zone_name),'^zone[[:space:]]*[0-9]+')),LOWER(TRIM(z.zone_name)))
            ORDER BY CHAR_LENGTH(z.zone_name) DESC,z.created_at DESC
          ) canonical_rank
        FROM zones z
      ), validated_counts AS (
        SELECT COALESCE(LOWER(REGEXP_SUBSTR(TRIM(z.zone_name),'^zone[[:space:]]*[0-9]+')),LOWER(TRIM(z.zone_name))) zone_key,
          COUNT(DISTINCT fr.report_id) report_count,
          MAX(fr.severity_level='Major Incident') major_count,
          MIN(fr.created_at) created_at,MAX(fr.updated_at) updated_at
        FROM zones z
        JOIN flood_report_zones frz ON frz.zone_id=z.zone_id
        JOIN flood_reports fr ON fr.report_id=frz.report_id AND fr.status='Validated'
        GROUP BY zone_key
        HAVING COUNT(DISTINCT fr.report_id)>=3
      )
      SELECT * FROM risk_zones
      UNION ALL
      SELECT CONCAT('auto-',z.zone_id) risk_zone_id,
        CONCAT('Automatic Flood Risk - ',z.zone_name) risk_zone_name,
        CASE WHEN c.report_count>=5 OR c.major_count>0 THEN 'High' ELSE 'Medium' END risk_level,
        z.polygon_geojson,
        CONCAT('Automatically generated from ',c.report_count,' validated flood reports in ',z.zone_name,'.') description,
        c.created_at,c.updated_at
      FROM zone_aliases z
      JOIN validated_counts c ON c.zone_key=z.zone_key
      WHERE z.canonical_rank=1
        AND NOT EXISTS(SELECT 1 FROM risk_zones rz WHERE rz.risk_zone_name=CONCAT('Automatic Flood Risk - ',z.zone_name))
      `),
    db.query(`SELECT s.*,(SELECT COUNT(*) FROM residents r WHERE r.evacuation_shelter_id=s.shelter_id AND r.evacuation_status='Evacuated' AND r.record_status='Active') current_occupancy
      FROM shelters s WHERE s.status!='Unavailable' AND s.record_status='Active'`),
    db.query(`SELECT report_id,tracking_code,location_text,incident_type,latitude,longitude,description,photo_urls,severity_level,status,validated_at,created_at
              FROM flood_reports WHERE status='Validated'`),
    db.query("SELECT * FROM evacuation_routes WHERE status!='Closed'")
  ]);
  res.json({ center: { latitude: 13.7828976, longitude: 122.8852784 }, zones, riskZones, shelters, reports, routes, refreshedAt: new Date().toISOString() });
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
  filterFields?: Record<string, { column?: string; sql?: string; exact?: boolean; present?: boolean; operator?: ">=" | "<=" }>;
};

const resources: Record<string, ResourceConfig> = {
  "barangay-zones": {
    table: "zones", idColumn: "zone_id", readRoles: ["Super Admin", "Disaster Officer", "Data Encoder"], writeRoles: ["Super Admin"],
    fields: { zoneName: "zone_name", zoneColor: "zone_color", polygonGeoJson: "polygon_geojson", description: "description" },
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
      CONCAT(
        LPAD(CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(h.household_number,'-',1),'Z',-1) AS UNSIGNED),10,'0'),
        LPAD(CAST(SUBSTRING_INDEX(h.household_number,'-',-1) AS UNSIGNED),10,'0')
      ) household_sort_key,
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
    searchColumns: ["h.household_number", "h.address_line", "h.head_of_household_name", "h.verification_status"], sortFields: ["household_number", "household_sort_key", "address_line", "verification_status", "created_at", "updated_at"],
    filterFields: { zone: { column: "h.zone_id", exact: true } }
  },
  residents: {
    table: "residents r", idColumn: "resident_id", columns: "r.*,CAST(r.date_of_birth AS CHAR) date_of_birth,TIMESTAMPDIFF(YEAR,r.date_of_birth,CURDATE()) age,(SELECT s.shelter_name FROM shelters s WHERE s.shelter_id=r.evacuation_shelter_id) evacuation_shelter_name,(SELECT h.household_number FROM households h WHERE h.household_id=r.household_id) household_number,(SELECT h.zone_id FROM households h WHERE h.household_id=r.household_id) zone_id,(SELECT z.zone_name FROM households h JOIN zones z ON z.zone_id=h.zone_id WHERE h.household_id=r.household_id) zone_name",
    readRoles: ["Super Admin", "Disaster Officer", "Data Encoder"], writeRoles: ["Super Admin", "Disaster Officer", "Data Encoder"],
    fields: { householdId: "household_id", fullName: "full_name", dateOfBirth: "date_of_birth", sex: "sex", contactNumber: "contact_number", addressLine: "address_line", vulnerabilityType: "vulnerability_type", vulnerabilityOther: "vulnerability_other", relationshipToHead: "relationship_to_head", relationshipOther: "relationship_other", maritalStatus: "marital_status", outOfSchoolYouth: "out_of_school_youth", occupation: "occupation", education: "education", philsysNumber: "philsys_number", philhealthNumber: "philhealth_number", fpUse: "fp_use", unmetNeeds: "unmet_needs", pwdSpecify: "pwd_specify", soloParent: "solo_parent", morbidity: "morbidity", waterSourceLevel: "water_source_level", sanitaryToilet: "sanitary_toilet", canSwim: "can_swim", houseType: "house_type", emergencyContactName: "emergency_contact_name", emergencyContactNumber: "emergency_contact_number", priorityLevel: "priority_level", evacuationStatus: "evacuation_status", recordStatus: "record_status", evacuationShelterId: "evacuation_shelter_id" },
    required: ["householdId", "fullName", "dateOfBirth", "sex", "addressLine", "priorityLevel"],
    searchColumns: ["r.full_name", "r.address_line", "r.vulnerability_type", "r.contact_number", "(SELECT h.household_number FROM households h WHERE h.household_id=r.household_id)"], sortFields: ["r.full_name", "r.date_of_birth", "r.priority_level", "r.evacuation_status", "r.created_at", "r.updated_at"],
    filterFields: { zone: { sql: "EXISTS(SELECT 1 FROM households h WHERE h.household_id=r.household_id AND h.zone_id=?)", exact: true }, household: { column: "r.household_id", exact: true }, vulnerability: { column: "r.vulnerability_type", exact: true }, vulnerable: { column: "r.vulnerability_type", present: true }, status: { column: "r.evacuation_status", exact: true }, priority: { column: "r.priority_level", exact: true }, shelter: { column: "r.evacuation_shelter_id", exact: true } }
  },
  shelters: {
    table: "shelters s", idColumn: "shelter_id", columns: "s.*,(SELECT COUNT(*) FROM residents r WHERE r.evacuation_shelter_id=s.shelter_id AND r.evacuation_status='Evacuated' AND r.record_status='Active') resident_occupancy", readRoles: ["Super Admin", "Disaster Officer", "Data Encoder"], writeRoles: ["Super Admin", "Disaster Officer", "Data Encoder"],
    fields: { shelterName: "shelter_name", zoneId: "zone_id", locationText: "location_text", latitude: "latitude", longitude: "longitude", capacity: "capacity", currentOccupancy: "current_occupancy", contactPerson: "contact_person", contactNumber: "contact_number", email: "email", status: "status", recordStatus: "record_status" },
    required: ["shelterName", "zoneId", "locationText", "latitude", "longitude", "capacity", "contactPerson", "contactNumber", "status"],
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
function validPhilippineContactNumber(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return true;
  if (text.length > 30 || !/^\+?[0-9() -]+$/.test(text)) return false;
  const digits = text.replace(/[() -]/g, "");
  const local = digits.startsWith("+63") ? `0${digits.slice(3)}` : digits;
  return /^09\d{9}$/.test(local) || /^0[2-8]\d{7,9}$/.test(local) || /^[1-9]\d{6,7}$/.test(local);
}
async function validateResource(path: string, body: Record<string, any>, recordId?: string, executor: Pick<typeof db, "query"> = db) {
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
    const [matches] = await executor.query<any[]>(
      `SELECT ${reference.column} FROM ${reference.table} WHERE ${reference.column}=? LIMIT 1`,
      [value]
    );
    if (!matches[0]) throw new z.ZodError([{ code: "custom", path: [reference.field], message: `Select an existing ${reference.label}` }]);
  }
  if (path === "residents") {
    for (const [field, allowed] of Object.entries({ canSwim: ["Yes", "No"], houseType: ["Concrete", "Semi concrete", "Light materials"] })) {
      const value = body[field];
      if (value !== undefined && value !== null && value !== "" && !allowed.includes(value)) {
        throw new z.ZodError([{ code: "custom", path: [field], message: `Select a valid ${field === "canSwim" ? "swimming ability" : "house type"}` }]);
      }
    }
    if (body.dateOfBirth && new Date(body.dateOfBirth) > new Date()) throw new z.ZodError([{ code: "custom", path: ["dateOfBirth"], message: "Date of birth cannot be in the future" }]);
    if (body.householdId) {
      const [households] = await executor.query<any[]>("SELECT household_id FROM households WHERE household_id=? LIMIT 1", [body.householdId]);
      if (!households[0]) {
        throw new z.ZodError([{ code: "custom", path: ["householdId"], message: "Select an existing household" }]);
      }
    }
    if (body.recordStatus !== undefined && !["Active", "Inactive"].includes(String(body.recordStatus))) {
      throw new z.ZodError([{ code: "custom", path: ["recordStatus"], message: "Select a valid resident status" }]);
    }
    if (body.evacuationStatus === "Evacuated" && !body.evacuationShelterId) {
      throw new z.ZodError([{ code: "custom", path: ["evacuationShelterId"], message: "Select the evacuation center where the resident is staying" }]);
    }
    if (body.evacuationShelterId) {
      const [shelters] = await executor.query<any[]>(`SELECT s.shelter_id,s.capacity,
        (SELECT COUNT(*) FROM residents r WHERE r.evacuation_shelter_id=s.shelter_id AND r.evacuation_status='Evacuated' AND r.record_status='Active' AND (? IS NULL OR r.resident_id!=?)) resident_occupancy
        FROM shelters s WHERE s.shelter_id=? AND s.record_status='Active' LIMIT 1`, [recordId ?? null, recordId ?? null, body.evacuationShelterId]);
      if (!shelters[0]) throw new z.ZodError([{ code: "custom", path: ["evacuationShelterId"], message: "Select an active evacuation center" }]);
      if (body.evacuationStatus === "Evacuated" && Number(shelters[0].resident_occupancy) >= Number(shelters[0].capacity)) {
        throw new z.ZodError([{ code: "custom", path: ["evacuationShelterId"], message: "The selected evacuation center is already at full capacity" }]);
      }
    }
    if (body.fullName && body.dateOfBirth && body.householdId) {
      const [duplicates] = await executor.query<any[]>(
        "SELECT resident_id FROM residents WHERE full_name=? AND date_of_birth=? AND household_id=? AND (? IS NULL OR resident_id!=?) LIMIT 1",
        [body.fullName, body.dateOfBirth, body.householdId, recordId ?? null, recordId ?? null]
      );
      if (duplicates[0]) throw Object.assign(new Error("Duplicate resident record"), { code: "ER_DUP_ENTRY" });
    }
  }
  if (path === "households") {
    if (body.householdNumber !== undefined) {
      const householdNumber = String(body.householdNumber).trim();
      if (!/^Z[1-9]\d*-\d+$/.test(householdNumber)) {
        throw new z.ZodError([{ code: "custom", path: ["householdNumber"], message: "Household number must use the format Z1-1, Z2-1, etc." }]);
      }
    }
    if (body.verificationStatus !== undefined) {
      const validStatuses = ["Pending Verification", "Verified", "Rejected"];
      if (!validStatuses.includes(String(body.verificationStatus))) {
        throw new z.ZodError([{ code: "custom", path: ["verificationStatus"], message: "Select a valid household verification status" }]);
      }
    }
  }
  for (const field of path === "residents" ? ["contactNumber", "emergencyContactNumber"] : path === "households" ? ["contactNumber"] : []) {
    if (!validPhilippineContactNumber(body[field])) {
      throw new z.ZodError([{ code: "custom", path: [field], message: "Enter a valid Philippine mobile or landline number." }]);
    }
  }
  if (path === "barangay-zones" && body.zoneColor !== undefined && !/^#[0-9a-f]{6}$/i.test(String(body.zoneColor))) {
    throw new z.ZodError([{ code: "custom", path: ["zoneColor"], message: "Boundary color must be a valid hex color" }]);
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
    if (body.recordStatus !== undefined && !["Active", "Inactive"].includes(String(body.recordStatus))) {
      throw new z.ZodError([{ code: "custom", path: ["recordStatus"], message: "Select a valid evacuation center status" }]);
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

async function syncShelterOccupancy(connection: any, shelterIds: Array<string | null | undefined>) {
  for (const shelterId of [...new Set(shelterIds.filter(Boolean) as string[])]) {
    await connection.execute(
      `UPDATE shelters s SET current_occupancy=(SELECT COUNT(*) FROM residents r
       WHERE r.evacuation_shelter_id=s.shelter_id AND r.evacuation_status='Evacuated' AND r.record_status='Active'),
       status=CASE
         WHEN s.record_status='Inactive' OR s.status='Unavailable' THEN 'Unavailable'
         WHEN (SELECT COUNT(*) FROM residents r WHERE r.evacuation_shelter_id=s.shelter_id AND r.evacuation_status='Evacuated' AND r.record_status='Active') >= s.capacity THEN 'Full'
         WHEN (SELECT COUNT(*) FROM residents r WHERE r.evacuation_shelter_id=s.shelter_id AND r.evacuation_status='Evacuated' AND r.record_status='Active') >= CEIL(s.capacity * 0.8) THEN 'Near Capacity'
         ELSE 'Available' END
       WHERE s.shelter_id=?`,
      [shelterId]
    );
  }
}

function mysqlDateTime(date: Date) {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

app.post("/api/shelters/:id/assignments", requireAuth, requireRoles("Super Admin", "Disaster Officer", "Data Encoder"), asyncRoute(async (req: AuthRequest, res) => {
  const input = z.object({
    residentIds: z.array(z.string().uuid()).min(1).max(100).transform((ids) => [...new Set(ids)]),
    evacuationAt: z.coerce.date(),
    evacuationStatus: z.enum(["Safe", "For Monitoring", "For Evacuation", "Evacuated"]).default("Evacuated")
  }).parse(req.body);
  const shelterId = String(req.params.id);
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [shelters] = await connection.query<any[]>("SELECT shelter_id,capacity,status,record_status FROM shelters WHERE shelter_id=? FOR UPDATE", [shelterId]);
    const shelter = shelters[0];
    if (!shelter || shelter.record_status !== "Active" || shelter.status === "Unavailable") {
      await connection.rollback();
      return res.status(409).json({ message: "The selected evacuation center is unavailable" });
    }
    const [residents] = await connection.query<any[]>(
      "SELECT resident_id,evacuation_shelter_id,evacuation_status,record_status FROM residents WHERE resident_id IN (?) FOR UPDATE",
      [input.residentIds]
    );
    if (residents.length !== input.residentIds.length || residents.some((resident) => resident.record_status !== "Active")) {
      await connection.rollback();
      return res.status(400).json({ message: "One or more selected residents are unavailable" });
    }
    const duplicate = residents.find((resident) => resident.evacuation_status === "Evacuated" && resident.evacuation_shelter_id === shelterId);
    if (duplicate) {
      await connection.rollback();
      return res.status(409).json({ message: "A selected resident is already assigned to this evacuation center" });
    }
    const [occupancyRows] = await connection.query<any[]>(
      "SELECT COUNT(*) occupancy FROM residents WHERE evacuation_shelter_id=? AND evacuation_status='Evacuated' AND record_status='Active'",
      [shelterId]
    );
    if (input.evacuationStatus === "Evacuated" && Number(occupancyRows[0]?.occupancy ?? 0) + residents.length > Number(shelter.capacity)) {
      await connection.rollback();
      return res.status(409).json({ message: "Not enough remaining capacity for the selected residents" });
    }
    const affectedShelters = residents.map((resident) => resident.evacuation_shelter_id);
    for (const resident of residents) {
      const action = resident.evacuation_status === "Evacuated" && resident.evacuation_shelter_id ? "Transferred" : "Assigned";
      await connection.execute("UPDATE residents SET evacuation_shelter_id=?,evacuation_status=? WHERE resident_id=?", [shelterId, input.evacuationStatus, resident.resident_id]);
      await connection.execute(
        "INSERT INTO evacuation_assignments(assignment_id,resident_id,shelter_id,action,evacuation_at,recorded_by_user_id) VALUES(?,?,?,?,?,?)",
        [randomUUID(), resident.resident_id, shelterId, action, mysqlDateTime(input.evacuationAt), req.user!.userId]
      );
    }
    await syncShelterOccupancy(connection, [...affectedShelters, shelterId]);
    await connection.commit();
    res.json({ message: `${residents.length} resident${residents.length === 1 ? "" : "s"} assigned successfully`, assignedCount: residents.length });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}));

app.post("/api/residents/:id/return-home", requireAuth, requireRoles("Super Admin", "Disaster Officer", "Data Encoder"), asyncRoute(async (req: AuthRequest, res) => {
  const input = z.object({ returnedAt: z.coerce.date() }).parse(req.body);
  const residentId = String(req.params.id);
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query<any[]>("SELECT resident_id,evacuation_shelter_id,evacuation_status FROM residents WHERE resident_id=? FOR UPDATE", [residentId]);
    const resident = rows[0];
    if (!resident) { await connection.rollback(); return res.status(404).json({ message: "Resident not found" }); }
    if (resident.evacuation_status !== "Evacuated" || !resident.evacuation_shelter_id) { await connection.rollback(); return res.status(409).json({ message: "Resident is not currently assigned to an evacuation center" }); }
    await connection.execute("UPDATE residents SET evacuation_shelter_id=NULL,evacuation_status='Safe' WHERE resident_id=?", [residentId]);
    await connection.execute(
      "INSERT INTO evacuation_assignments(assignment_id,resident_id,shelter_id,action,evacuation_at,recorded_by_user_id) VALUES(?,?,?,?,?,?)",
      [randomUUID(), residentId, resident.evacuation_shelter_id, "Returned Home", mysqlDateTime(input.returnedAt), req.user!.userId]
    );
    await syncShelterOccupancy(connection, [resident.evacuation_shelter_id]);
    await connection.commit();
    res.json({ message: "Resident marked as Returned Home" });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}));

const residentSnapshotColumns = [
  "resident_id", "household_id", "full_name", "date_of_birth", "sex", "contact_number", "address_line",
  "vulnerability_type", "vulnerability_other", "relationship_to_head", "relationship_other", "marital_status",
  "out_of_school_youth", "occupation", "education", "philsys_number", "philhealth_number", "fp_use",
  "unmet_needs", "pwd_specify", "solo_parent", "morbidity", "water_source_level", "sanitary_toilet",
  "can_swim", "house_type", "emergency_contact_name", "emergency_contact_number", "priority_level",
  "evacuation_status", "record_status", "evacuation_shelter_id"
];

function currentResidentSnapshotYear() {
  return Number(new Intl.DateTimeFormat("en", { timeZone: "Asia/Manila", year: "numeric" }).format(new Date()));
}

async function refreshCurrentResidentSnapshot() {
  const year = currentResidentSnapshotYear();
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute("DELETE FROM resident_year_snapshots WHERE snapshot_year=?", [year]);
    await connection.execute("DELETE FROM household_year_snapshots WHERE snapshot_year=?", [year]);
    await connection.execute(
      `INSERT INTO household_year_snapshots (
        snapshot_year,household_id,household_number,zone_id,zone_name,address_line,
        head_of_household_name,contact_number,verification_status,captured_at
      ) SELECT ?,h.household_id,h.household_number,h.zone_id,z.zone_name,h.address_line,
        h.head_of_household_name,h.contact_number,h.verification_status,NOW()
        FROM households h JOIN zones z ON z.zone_id=h.zone_id`, [year]
    );
    await connection.execute(
      `INSERT INTO resident_year_snapshots (
        snapshot_year,resident_id,household_id,household_number,zone_id,zone_name,household_address,
        head_of_household_name,${residentSnapshotColumns.slice(2).join(",")},source_created_at,source_updated_at,captured_at
      ) SELECT ?,r.resident_id,r.household_id,h.household_number,h.zone_id,z.zone_name,h.address_line,
        h.head_of_household_name,${residentSnapshotColumns.slice(2).map(column => `r.${column}`).join(",")},r.created_at,r.updated_at,NOW()
        FROM residents r JOIN households h ON h.household_id=r.household_id JOIN zones z ON z.zone_id=h.zone_id`, [year]
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  return year;
}

app.get("/api/residents/yearly", requireAuth, requireRoles("Super Admin", "Disaster Officer", "Data Encoder"), asyncRoute(async (req, res) => {
  const currentYear = currentResidentSnapshotYear();
  const requestedYear = Number(req.query.year ?? currentYear);
  if (!Number.isInteger(requestedYear) || requestedYear < 2000 || requestedYear > currentYear) {
    return res.status(400).json({ message: `Year must be between 2000 and ${currentYear}` });
  }
  if (requestedYear === currentYear) await refreshCurrentResidentSnapshot();

  const { page, pageSize, offset } = pagination(req);
  const search = String(req.query.search ?? "").trim();
  const params: unknown[] = [requestedYear];
  let where = "r.snapshot_year=?";
  if (search) {
    where += " AND (r.full_name LIKE ? OR r.address_line LIKE ? OR r.vulnerability_type LIKE ? OR r.contact_number LIKE ? OR r.household_number LIKE ?)";
    params.push(...Array(5).fill(`%${search}%`));
  }
  const exactFilters: Record<string, string> = {
    zone: "r.zone_id", household: "r.household_id", vulnerability: "r.vulnerability_type",
    status: "r.evacuation_status", priority: "r.priority_level"
  };
  for (const [name, column] of Object.entries(exactFilters)) {
    const value = String(req.query[`filter_${name}`] ?? "").trim();
    if (!value) continue;
    where += ` AND ${column}=?`;
    params.push(value);
  }
  if (String(req.query.filter_vulnerable ?? "") === "true") {
    where += ` AND (r.vulnerability_type IS NOT NULL AND TRIM(r.vulnerability_type)!=''
      OR r.pwd_specify IS NOT NULL AND TRIM(r.pwd_specify) NOT IN ('','NO','N/A')
      OR r.morbidity IS NOT NULL AND TRIM(r.morbidity) NOT IN ('','NO','N/A')
      OR TIMESTAMPDIFF(YEAR,r.date_of_birth,r.captured_at) NOT BETWEEN 18 AND 59)`;
  }
  for(const [name,condition] of Object.entries(residentQualityConditions)) {
    if(String(req.query[`filter_${name}`]??'')==='true') where+=` AND (${condition})`;
  }
  const sortMap: Record<string, string> = {
    "r.full_name": "r.full_name", "r.date_of_birth": "r.date_of_birth", "r.priority_level": "r.priority_level",
    "r.evacuation_status": "r.evacuation_status", "r.created_at": "r.source_created_at", "r.updated_at": "r.source_updated_at"
  };
  const sortBy = String(req.query.sortBy ?? "r.full_name");
  const sortColumn = sortMap[sortBy];
  const sortOrder = String(req.query.sortOrder ?? "asc").toLowerCase();
  if (!sortColumn) return res.status(400).json({ message: "Unsupported sortBy field" });
  if (!['asc', 'desc'].includes(sortOrder)) return res.status(400).json({ message: "sortOrder must be asc or desc" });

  const [items] = await db.query<any[]>(
    `SELECT r.*,CAST(r.date_of_birth AS CHAR) date_of_birth,TIMESTAMPDIFF(YEAR,r.date_of_birth,r.captured_at) age,
      (SELECT s.shelter_name FROM shelters s WHERE s.shelter_id=r.evacuation_shelter_id) evacuation_shelter_name
      FROM resident_year_snapshots r WHERE ${where} ORDER BY ${sortColumn} ${sortOrder.toUpperCase()} LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  );
  const [countRows] = await db.query<any[]>(`SELECT COUNT(*) total FROM resident_year_snapshots r WHERE ${where}`, params);
  const [summaryRows] = await db.query<any[]>(
    `SELECT COUNT(*) totalResidents,COUNT(DISTINCT household_id) totalHouseholds,
      SUM(priority_level='High') highPriorityResidents,
      SUM(TIMESTAMPDIFF(YEAR,date_of_birth,captured_at)>=60) seniorCitizens,
      SUM(TIMESTAMPDIFF(YEAR,date_of_birth,captured_at)<18) children,
      SUM(vulnerability_type IN ('Disability','PWD','Person with Disability') OR (pwd_specify IS NOT NULL AND TRIM(pwd_specify) NOT IN ('','NO','N/A'))) personsWithDisability,
      SUM(vulnerability_type='Pregnant') pregnantResidents,
      SUM(morbidity IS NOT NULL AND TRIM(morbidity) NOT IN ('','NO','N/A')) residentsWithMorbidity,
      SUM(vulnerability_type IS NOT NULL AND TRIM(vulnerability_type)!='' OR
        pwd_specify IS NOT NULL AND TRIM(pwd_specify) NOT IN ('','NO','N/A') OR
        morbidity IS NOT NULL AND TRIM(morbidity) NOT IN ('','NO','N/A') OR
        TIMESTAMPDIFF(YEAR,date_of_birth,captured_at) NOT BETWEEN 18 AND 59) vulnerableResidents
      FROM resident_year_snapshots WHERE snapshot_year=?`, [requestedYear]
  );
  const [yearRows] = await db.query<any[]>("SELECT DISTINCT snapshot_year year FROM resident_year_snapshots ORDER BY snapshot_year DESC");
  const recentYears = Array.from({ length: 6 }, (_, index) => currentYear - index);
  const availableYears = [...new Set([...recentYears, ...yearRows.map(row => Number(row.year))])].sort((a, b) => b - a);
  const totalItems = Number(countRows[0]?.total ?? 0);
  const summary = Object.fromEntries(Object.entries(summaryRows[0] ?? {}).map(([key, value]) => [key, Number(value ?? 0)]));
  res.json({ items, page, pageSize, totalItems, totalPages: Math.ceil(totalItems / pageSize), year: requestedYear, currentYear, availableYears, summary });
}));

app.post('/api/residents/import', requireAuth, requireRoles('Super Admin', 'Data Encoder'), asyncRoute(async (req, res) => {
  const input = z.object({ csv: z.string().min(1).max(500_000), preview: z.boolean() }).parse(req.body);
  let rows: Record<string, string>[];
  try { rows = parseResidentCsv(input.csv); }
  catch (error) { return res.status(400).json({ message: (error as Error).message }); }
  const connection = await db.getConnection();
  let rowNumber = 2;
  try {
    await connection.beginTransaction();
    const seen = new Set<string>();
    const resource = resources.residents!;
    for (const row of rows) {
      const parsed = residentImportSchema.parse(row);
      const [households] = await connection.query<any[]>('SELECT household_id FROM households WHERE household_number=? FOR UPDATE', [parsed.household_number]);
      if (households.length !== 1) throw new Error('Select an existing, unique household number.');
      const body: Record<string, any> = { householdId: households[0].household_id };
      for (const [field, column] of Object.entries(resource.fields)) if (parsed[column as keyof typeof parsed] !== undefined) body[field] = parsed[column as keyof typeof parsed];
      const key = JSON.stringify([body.householdId, body.fullName.toLowerCase(), body.dateOfBirth]);
      if (seen.has(key)) throw new Error('Duplicate resident in this CSV.');
      seen.add(key);
      await validateResource('residents', body, undefined, connection);
      if (!input.preview) {
        const entries = Object.entries(resource.fields).filter(([field]) => body[field] !== undefined);
        await connection.execute(`INSERT INTO residents (resident_id,${entries.map(([, column]) => column).join(',')}) VALUES (${['?', ...entries.map(() => '?')].join(',')})`, [randomUUID(), ...entries.map(([field]) => body[field])]);
      }
      rowNumber++;
    }
    if (input.preview) await connection.rollback(); else await connection.commit();
    res.json({ count: rows.length, message: input.preview ? `${rows.length} residents ready to import.` : `${rows.length} residents imported successfully.` });
  } catch (error: any) {
    await connection.rollback();
    if (error instanceof z.ZodError || error.code === 'ER_DUP_ENTRY' || !error.code) {
      return res.status(400).json({ message: `Row ${rowNumber}: ${error instanceof z.ZodError ? error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ') : error.message}. No residents were imported.` });
    }
    throw error;
  } finally { connection.release(); }
}));

app.get('/api/households/:id/details', requireAuth, requireRoles('Super Admin','Data Encoder'), asyncRoute(async (req,res)=>{
  const [households] = await db.query<any[]>('SELECT h.household_id,h.household_number,h.head_of_household_name,h.address_line,h.contact_number,h.verification_status,h.updated_at,z.zone_name FROM households h JOIN zones z ON z.zone_id=h.zone_id WHERE h.household_id=? LIMIT 1',[String(req.params.id)]);
  if (!households[0]) return res.status(404).json({message:'Household not found'});
  const [residents] = await db.query<any[]>('SELECT r.*,CAST(r.date_of_birth AS CHAR) date_of_birth,s.shelter_name FROM residents r LEFT JOIN shelters s ON s.shelter_id=r.evacuation_shelter_id WHERE r.household_id=? ORDER BY r.full_name',[String(req.params.id)]);
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  res.json({household:households[0],members:residents.map(r=>{const risks=vulnerabilities(r,today);return {id:r.resident_id,name:r.full_name,relationship:r.relationship_to_head,status:r.evacuation_status,recordStatus:r.record_status,priority:r.priority_level,vulnerabilities:risks,...residentReadiness(r,risks),assistance:[r.can_swim==='No'?'Cannot swim':null,r.house_type==='Light materials'?'Home built from light materials':null].filter(Boolean),shelter:r.shelter_name,updatedAt:r.updated_at};})});
}));

app.get('/api/residents/:id/details',requireAuth,requireRoles('Super Admin','Data Encoder','Disaster Officer'),asyncRoute(async(req,res)=>{
  const [rows]=await db.query<any[]>('SELECT r.*,CAST(r.date_of_birth AS CHAR) date_of_birth,h.household_number,z.zone_name,s.shelter_name FROM residents r LEFT JOIN households h ON h.household_id=r.household_id LEFT JOIN zones z ON z.zone_id=h.zone_id LEFT JOIN shelters s ON s.shelter_id=r.evacuation_shelter_id WHERE r.resident_id=? LIMIT 1',[String(req.params.id)]);
  if(!rows[0])return res.status(404).json({message:'Resident not found'});
  const r=rows[0],today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()),risks=vulnerabilities(r,today);
  const [history]=await db.query<any[]>('SELECT a.assignment_id,a.action,a.evacuation_at,a.created_at,s.shelter_name,u.full_name recorded_by FROM evacuation_assignments a LEFT JOIN shelters s ON s.shelter_id=a.shelter_id LEFT JOIN users u ON u.user_id=a.recorded_by_user_id WHERE a.resident_id=? ORDER BY a.created_at DESC,a.assignment_id',[String(req.params.id)]);
  res.json({resident:r,vulnerabilities:risks,...residentReadiness(r,risks),history});
}));

app.get('/api/records/quality',requireAuth,requireRoles('Super Admin','Data Encoder','Disaster Officer'),asyncRoute(async(_req,res)=>{
  const [rows]=await db.query<any[]>(`SELECT ${Object.entries(residentQualityConditions).map(([key,condition])=>`COALESCE(SUM(${condition}),0) ${key}`).join(',')} FROM residents r`);
  const [reports]=await db.query<any[]>(`SELECT COALESCE(SUM(status IN ('Submitted','Under Review')),0) pending,COALESCE(SUM(${reportMissingZone}),0) missingZone FROM flood_reports`);
  res.json({...rows[0],...reports[0]});
}));

for(const [name,condition] of Object.entries(residentQualityConditions)) resources.residents!.filterFields![name]={sql:`(${condition}) AND ?='true'`,exact:true};
for (const [path, resource] of Object.entries(resources)) {
  app.get(`/api/${path}`, requireAuth, requireRoles(...resource.readRoles), asyncRoute(async (req, res) => paginated(res, resource.table, req, {
    columns: resource.columns,
    searchColumns: resource.searchColumns,
    sortFields: resource.sortFields,
    filterFields: resource.filterFields
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

for (const path of ["residents", "shelters", "volunteers", "evacuation-routes", "emergency-contacts"]) {
  const resource = resources[path]!;
  app.delete(`/api/${path}/:id`, requireAuth, requireRoles(...resource.writeRoles), asyncRoute(async (req, res) => {
    const recordId = String(req.params.id);
    if (path === "shelters") {
      const connection = await db.getConnection();
      try {
        await connection.beginTransaction();
        const [existing] = await connection.query<any[]>("SELECT shelter_id FROM shelters WHERE shelter_id=? FOR UPDATE", [recordId]);
        if (!existing[0]) {
          await connection.rollback();
          return res.status(404).json({ message: "Evacuation center not found" });
        }
        await connection.execute(
          "UPDATE residents SET evacuation_shelter_id=NULL,evacuation_status=CASE WHEN evacuation_status='Evacuated' THEN 'For Evacuation' ELSE evacuation_status END WHERE evacuation_shelter_id=?",
          [recordId]
        );
        await connection.execute("UPDATE evacuation_assignments SET shelter_id=NULL WHERE shelter_id=?", [recordId]);
        await connection.execute("DELETE FROM evacuation_routes WHERE destination_shelter_id=?", [recordId]);
        await connection.execute("DELETE FROM shelters WHERE shelter_id=?", [recordId]);
        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
      return res.status(204).end();
    }
    const [result] = await db.execute<any>(
      `DELETE FROM ${baseTable(resource.table)} WHERE ${resource.idColumn}=?`,
      [recordId]
    );
    if (!result.affectedRows) return res.status(404).json({ message: "Evacuation support record not found" });
    res.status(204).end();
  }));
}

app.delete("/api/households/:id", requireAuth, requireRoles("Super Admin", "Data Encoder"), asyncRoute(async (req, res) => {
  const householdId = String(req.params.id);
  const [[household]] = await db.query<any[]>("SELECT household_number FROM households WHERE household_id=?", [householdId]);
  if (!household) return res.status(404).json({ message: "Household not found" });
  const [[members]] = await db.query<any[]>("SELECT COUNT(*) member_count FROM residents WHERE household_id=?", [householdId]);
  if (Number(members.member_count) > 0) {
    return res.status(409).json({ message: `Household ${household.household_number} still has ${members.member_count} resident record(s). Reassign or delete those residents first.` });
  }
  await db.execute("DELETE FROM households WHERE household_id=?", [householdId]);
  res.status(204).end();
}));

app.delete("/api/barangay-zones/:id", requireAuth, requireRoles("Super Admin"), asyncRoute(async (req, res) => {
  const zoneId = String(req.params.id);
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [existing] = await connection.query<any[]>("SELECT zone_id,zone_name FROM zones WHERE zone_id=? FOR UPDATE", [zoneId]);
    if (!existing[0]) {
      await connection.rollback();
      return res.status(404).json({ message: "Barangay zone not found" });
    }
    const zoneNumber = String(existing[0].zone_name).match(/^zone\s*(\d+)/i)?.[1];
    const [replacementRows] = zoneNumber
      ? await connection.query<any[]>("SELECT zone_id,zone_name FROM zones WHERE zone_id<>? AND LOWER(zone_name) LIKE ? ORDER BY CHAR_LENGTH(zone_name) DESC LIMIT 1 FOR UPDATE", [zoneId, `zone ${zoneNumber}%`])
      : [[]];
    const replacement = replacementRows[0];
    const [references] = await connection.query<any[]>("SELECT (SELECT COUNT(*) FROM households WHERE zone_id=?) household_count,(SELECT COUNT(*) FROM shelters WHERE zone_id=?) shelter_count", [zoneId, zoneId]);
    const householdCount = Number(references[0]?.household_count ?? 0);
    const shelterCount = Number(references[0]?.shelter_count ?? 0);
    if ((householdCount || shelterCount) && !replacement) {
      await connection.rollback();
      return res.status(409).json({
        message: `Move or delete ${householdCount} linked household${householdCount === 1 ? "" : "s"} and ${shelterCount} evacuation center${shelterCount === 1 ? "" : "s"} before deleting this zone.`
      });
    }
    if (replacement) {
      await connection.execute("UPDATE households SET zone_id=? WHERE zone_id=?", [replacement.zone_id, zoneId]);
      await connection.execute("UPDATE shelters SET zone_id=? WHERE zone_id=?", [replacement.zone_id, zoneId]);
      await connection.execute("UPDATE volunteers SET assigned_zone_id=? WHERE assigned_zone_id=?", [replacement.zone_id, zoneId]);
      await connection.execute("UPDATE evacuation_routes SET origin_zone_id=? WHERE origin_zone_id=?", [replacement.zone_id, zoneId]);
      await connection.execute("INSERT IGNORE INTO flood_report_zones(report_id,zone_id) SELECT report_id,? FROM flood_report_zones WHERE zone_id=?", [replacement.zone_id, zoneId]);
      await connection.execute("INSERT IGNORE INTO notification_target_zones(notification_id,zone_id) SELECT notification_id,? FROM notification_target_zones WHERE zone_id=?", [replacement.zone_id, zoneId]);
    } else {
      await connection.execute("UPDATE volunteers SET assigned_zone_id=NULL WHERE assigned_zone_id=?", [zoneId]);
      await connection.execute("DELETE FROM evacuation_routes WHERE origin_zone_id=?", [zoneId]);
    }
    await connection.execute("DELETE FROM flood_report_zones WHERE zone_id=?", [zoneId]);
    await connection.execute("DELETE FROM notification_target_zones WHERE zone_id=?", [zoneId]);
    await connection.execute("DELETE FROM zones WHERE zone_id=?", [zoneId]);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  res.status(204).end();
}));

app.delete("/api/risk-zones/:id", requireAuth, requireRoles("Super Admin"), asyncRoute(async (req, res) => {
  const [result] = await db.execute<any>("DELETE FROM risk_zones WHERE risk_zone_id=?", [String(req.params.id)]);
  if (!result.affectedRows) return res.status(404).json({ message: "Risk zone not found" });
  res.status(204).end();
}));

app.get("/api/dashboard/summary", requireAuth, asyncRoute(async (_req, res) => {
  const [rows] = await db.query<any[]>(`SELECT
    (SELECT COUNT(*) FROM residents WHERE record_status='Active') totalResidents,
    (SELECT COUNT(*) FROM households) totalHouseholds,
    (SELECT COUNT(*) FROM residents WHERE record_status='Active' AND (
      vulnerability_type IS NOT NULL AND TRIM(vulnerability_type)!='' OR
      pwd_specify IS NOT NULL AND UPPER(TRIM(pwd_specify)) NOT IN ('','NO','N/A') OR
      morbidity IS NOT NULL AND UPPER(TRIM(morbidity)) NOT IN ('','NO','N/A') OR
      TIMESTAMPDIFF(YEAR,date_of_birth,CURDATE()) NOT BETWEEN 18 AND 59
    )) vulnerableResidents,
    (SELECT COUNT(*) FROM residents WHERE record_status='Active' AND UPPER(TRIM(priority_level))='HIGH') highPriorityResidents,
    (SELECT COUNT(*) FROM residents WHERE record_status='Active' AND UPPER(TRIM(priority_level))='MEDIUM') mediumPriorityResidents,
    (SELECT COUNT(*) FROM residents WHERE record_status='Active' AND UPPER(TRIM(priority_level))='LOW') lowPriorityResidents,
    (SELECT COUNT(*) FROM zones) totalZones,
    (SELECT COUNT(*) FROM flood_reports WHERE status IN ('Submitted','Under Review','Validated')) activeReports,
    (SELECT COUNT(*) FROM flood_reports WHERE status IN ('Submitted','Under Review')) pendingReports,
    (SELECT COUNT(*) FROM residents WHERE record_status='Active' AND evacuation_status='For Evacuation') forEvacuationResidents,
    (SELECT COUNT(*) FROM shelters s WHERE s.record_status='Active' AND s.status!='Unavailable' AND s.capacity>0
      AND (SELECT COUNT(*) FROM residents r WHERE r.evacuation_shelter_id=s.shelter_id AND r.evacuation_status='Evacuated' AND r.record_status='Active') >= s.capacity*0.8) nearCapacityShelters`);
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
  const [zoneAlerts] = await db.query<any[]>(`
    SELECT NULL report_id,NULL tracking_code,z.zone_name location_text,
      CASE WHEN COUNT(DISTINCT fr.report_id)>=5 THEN 'Rule-based Critical Risk' ELSE 'Rule-based High Risk' END incident_type,
      CONCAT(COUNT(DISTINCT fr.report_id),' active validated reports have been linked to this zone. Review DSS recommendations and prepare the appropriate response.') description,
      'Major Incident' severity_level,'Validated' status,MAX(fr.created_at) created_at,z.zone_name affected_zones
    FROM zones z
    JOIN flood_report_zones frz ON frz.zone_id=z.zone_id
    JOIN flood_reports fr ON fr.report_id=frz.report_id AND fr.status='Validated'
    GROUP BY z.zone_id,z.zone_name HAVING COUNT(DISTINCT fr.report_id)>=3
    ORDER BY COUNT(DISTINCT fr.report_id) DESC,MAX(fr.created_at) DESC LIMIT 1`);
  if (zoneAlerts[0]) return res.json({ alert: zoneAlerts[0] });
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
app.get("/api/notifications/:id", requireAuth, requireRoles("Super Admin", "Disaster Officer"), asyncRoute(async (req, res) => {
  const id = String(req.params.id);
  const [rows] = await db.execute<any[]>("SELECT notification_id,title,message,type,severity_level,target_audience,status FROM notifications WHERE notification_id=?", [id]);
  if (!rows[0]) return res.status(404).json({ message: "Notification not found" });
  const [zones] = await db.execute<any[]>("SELECT zone_id FROM notification_target_zones WHERE notification_id=?", [id]);
  res.json({ ...rows[0], zone_ids: zones.map((zone) => zone.zone_id) });
}));
app.post("/api/notifications", requireAuth, requireRoles("Super Admin", "Disaster Officer"), asyncRoute(async (req, res) => {
  const input = notificationInput.parse(req.body);
  if (input.targetAudience === "Affected Zones" && !input.zoneIds.length) return res.status(400).json({ message: "Select at least one affected zone.", fieldErrors: { zoneIds: "Select at least one affected zone." } });
  const id = randomUUID();
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute(
      "INSERT INTO notifications(notification_id,flood_report_id,title,message,type,severity_level,target_audience) VALUES(?,?,?,?,?,?,?)",
      [id, input.floodReportId ?? null, input.title, input.message, input.type, input.severityLevel, input.targetAudience]
    );
    for (const zoneId of input.targetAudience === "Affected Zones" ? input.zoneIds : []) await connection.execute("INSERT INTO notification_target_zones(notification_id,zone_id) VALUES(?,?)", [id, zoneId]);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally { connection.release(); }
  res.status(201).json({ notificationId: id });
}));
app.put("/api/notifications/:id", requireAuth, requireRoles("Super Admin", "Disaster Officer"), asyncRoute(async (req, res) => {
  const input = notificationInput.parse(req.body);
  if (input.targetAudience === "Affected Zones" && !input.zoneIds.length) return res.status(400).json({ message: "Select at least one affected zone.", fieldErrors: { zoneIds: "Select at least one affected zone." } });
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
    for (const zoneId of input.targetAudience === "Affected Zones" ? input.zoneIds : []) await connection.execute("INSERT INTO notification_target_zones(notification_id,zone_id) VALUES(?,?)", [String(req.params.id), zoneId]);
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

app.get("/api/statistics/dss", requireAuth, asyncRoute(async (req, res) => {
  res.json(await loadDss(req.query));
}));

for (const method of ['get', 'post'] as const) {
  app[method]('/api/statistics/dss/zones/:id/resident-status', requireAuth, requireRoles('Super Admin', 'Disaster Officer', 'Data Encoder'), asyncRoute(async (req, res) => {
    const zoneId = z.string().uuid().parse(req.params.id);
    const input = method === 'post' ? zoneStatusInput.parse(req.body) : undefined;
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const result = await criticalZoneStatus(connection, zoneId, input);
      await connection.commit();
      res.json(result);
    } catch (error: any) {
      await connection.rollback();
      if (error.status) return res.status(error.status).json({ message: error.message });
      throw error;
    } finally { connection.release(); }
  }));
}

let weatherCache: { expiresAt: number; value: unknown } | undefined;
app.get("/api/weather/current", asyncRoute(async (_req, res) => {
  if (weatherCache && weatherCache.expiresAt > Date.now()) return res.json(weatherCache.value);
  const params = new URLSearchParams({
    latitude: "13.7828976",
    longitude: "122.8852784",
    timezone: "Asia/Manila",
    forecast_days: "3",
    current: "temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,rain,weather_code,wind_speed_10m",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum"
  });
  const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, { signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error(`Weather provider returned ${response.status}`);
  const source = await response.json() as any;
  const daily = source.daily ?? {};
  const value = {
    location: "Colacling, Lupi, Camarines Sur",
    timezone: source.timezone,
    updatedAt: source.current?.time,
    current: source.current,
    forecast: (daily.time ?? []).map((date: string, index: number) => ({
      date,
      weatherCode: daily.weather_code?.[index],
      temperatureMax: daily.temperature_2m_max?.[index],
      temperatureMin: daily.temperature_2m_min?.[index],
      precipitationProbability: daily.precipitation_probability_max?.[index],
      precipitation: daily.precipitation_sum?.[index]
    })),
    source: "Open-Meteo"
  };
  weatherCache = { value, expiresAt: Date.now() + 10 * 60_000 };
  res.json(value);
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
      ST_GeomFromText(CONCAT('POINT(',fr.longitude,' ',fr.latitude,')'),4326)
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

// Serve the Angular build from the same Node.js site on SMARTERASP.NET.
if (existsSync(config.frontendDistRoot)) {
  app.use(express.static(config.frontendDistRoot, { index: false, maxAge: config.isProduction ? "1d" : 0 }));
  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api/") || !req.accepts("html")) return next();
    res.sendFile(join(config.frontendDistRoot, "index.html"));
  });
}

const inputLabels: Record<string, string> = {
  reporterName: "Reporter name",
  reporterContactInfo: "Reporter contact information",
  locationText: "Pinned location",
  incidentType: "Incident type",
  severityLevel: "Incident level",
  latitude: "Latitude",
  longitude: "Longitude",
  description: "Description",
  status: "Status",
  validationNotes: "Reviewer notes",
  zoneIds: "Affected Barangay Zones",
  email: "Email address",
  username: "Username",
  password: "Password"
};

function readableInputIssue(issue: z.core.$ZodIssue) {
  const fieldName = String(issue.path[issue.path.length - 1] ?? "form");
  const label = inputLabels[fieldName] ?? fieldName
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (letter) => letter.toUpperCase());
  if (issue.code === "invalid_type") return `${label} is required.`;
  if (issue.code === "invalid_value") return `Please select a valid ${label.toLowerCase()}.`;
  if (issue.code === "too_small") {
    const minimum = Number((issue as any).minimum ?? 0);
    return minimum <= 1 ? `${label} is required.` : `${label} must contain at least ${minimum} characters.`;
  }
  if (issue.code === "too_big") {
    const maximum = Number((issue as any).maximum ?? 0);
    return maximum ? `${label} must not exceed ${maximum} characters.` : `${label} is too long.`;
  }
  if (issue.code === "invalid_format") {
    return (issue as any).format === "email" ? `Enter a valid ${label.toLowerCase()}.` : `Please check the ${label.toLowerCase()} format.`;
  }
  return issue.message || `Please check ${label.toLowerCase()}.`;
}

function databaseErrorMessage(error: any) {
  switch (error?.code) {
    case "ER_NO_SUCH_TABLE": return "The database is missing a required table. Run the latest database initialization.";
    case "ER_BAD_FIELD_ERROR": return "The database schema is out of date. Run the latest database initialization.";
    case "ER_BAD_NULL_ERROR":
    case "ER_NO_DEFAULT_FOR_FIELD": return "Please complete all required fields.";
    case "ER_DATA_TOO_LONG": return "One of the entered values is too long. Please shorten it and try again.";
    case "WARN_DATA_TRUNCATED":
    case "ER_TRUNCATED_WRONG_VALUE": return "One of the entered values is invalid. Please review the form and try again.";
    case "ER_DUP_ENTRY": return "A record with the same unique value already exists.";
    case "ER_NO_REFERENCED_ROW_2": return "A selected related record no longer exists. Refresh the page and select it again.";
    case "ER_ROW_IS_REFERENCED_2": return "This record is still being used by other data and cannot be removed.";
    case "ECONNREFUSED":
    case "PROTOCOL_CONNECTION_LOST":
    case "ER_SERVER_SHUTDOWN": return "The database is temporarily unavailable. Start MySQL in XAMPP and try again.";
    default: return undefined;
  }
}

app.use(async (error: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (files.length) await Promise.all(files.map((file) => unlink(file.path).catch(() => undefined)));
  const databaseMessage = databaseErrorMessage(error);
  const validationIssues = error instanceof z.ZodError ? error.issues.map(readableInputIssue) : [];
  const status =
    validationIssues.length ? 400 :
    error?.status === 401 ? 401 :
    error?.type === "entity.parse.failed" ? 400 :
    ["LIMIT_FILE_SIZE", "LIMIT_FILE_COUNT"].includes(error?.code) ? 413 :
    error?.code === "ER_DUP_ENTRY" ? 409 :
    ["ER_NO_REFERENCED_ROW_2", "ER_BAD_NULL_ERROR", "ER_NO_DEFAULT_FOR_FIELD", "ER_DATA_TOO_LONG", "WARN_DATA_TRUNCATED", "ER_TRUNCATED_WRONG_VALUE"].includes(error?.code) ? 400 :
    ["ECONNREFUSED", "PROTOCOL_CONNECTION_LOST", "ER_SERVER_SHUTDOWN"].includes(error?.code) ? 503 :
    ["JsonWebTokenError", "TokenExpiredError"].includes(error?.name) ? 401 : 500;
  if (status === 500) console.error(`${req.method} ${req.path} failed`, error);
  const message = validationIssues[0]
    ?? databaseMessage
    ?? (error?.type === "entity.parse.failed"
      ? "The submitted form data is invalid. Refresh the page and try again."
      : ["LIMIT_FILE_SIZE", "LIMIT_FILE_COUNT"].includes(error?.code)
      ? "Upload up to 5 photos, with each file no larger than 5 MB."
      : status === 500
        ? "The server could not complete the request. Please try again."
        : error.message);
  const fieldErrors = error instanceof z.ZodError
    ? Object.fromEntries(error.issues.map((issue) => [String(issue.path[0] ?? 'form'), readableInputIssue(issue)]))
    : undefined;
  res.status(status).json({ message, issues: validationIssues.length ? validationIssues : undefined, fieldErrors });
});

app.listen(config.port, () => {
  console.log(`BantayBaha API listening on http://localhost:${config.port}`);
  void (async () => {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [zones] = await connection.query<any[]>("SELECT zone_id FROM zones");
      await syncAutomaticRiskZones(connection, zones.map((zone) => String(zone.zone_id)));
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      console.error("Automatic risk-zone synchronization failed:", error instanceof Error ? error.message : "Unknown error");
    } finally {
      connection.release();
    }
  })();
});
