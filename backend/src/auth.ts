import { createHash, randomUUID } from "node:crypto";
import type { NextFunction, Response } from "express";
import jwt, { type SignOptions } from "jsonwebtoken";
import { db } from "./db.js";
import { config } from "./config.js";
import type { AuthRequest, AuthUser, Role } from "./types.js";
import type { PoolConnection } from 'mysql2/promise';

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

export async function assertResidentApproved(user: AuthUser, connection: typeof db | PoolConnection = db) {
  if (user.role !== 'Resident') return;
  const [rows] = await connection.query<any[]>("SELECT a.user_id FROM resident_accounts a JOIN residents r ON r.resident_id=a.resident_id JOIN households h ON h.household_id=r.household_id WHERE a.user_id=? AND r.record_status='Active' AND h.verification_status='Verified' AND NOT EXISTS(SELECT 1 FROM resident_registrations s WHERE s.user_id=a.user_id AND s.status!='Approved')", [user.userId]);
  if (!rows.length) throw Object.assign(new Error('Your resident account must be validated and approved by the barangay secretary before you can sign in.'), {status:403});
}

export function createAccessToken(user: AuthUser) {
  return jwt.sign(user, config.accessSecret, { expiresIn: config.accessTtl } as SignOptions);
}

export async function createRefreshToken(user: AuthUser) {
  const tokenId = randomUUID();
  const token = jwt.sign({ ...user, tokenId }, config.refreshSecret, { expiresIn: config.refreshTtl } as SignOptions);
  const decoded = jwt.decode(token) as { exp: number };
  await db.execute(
    "INSERT INTO refresh_tokens (refresh_token_id,user_id,token_hash,expires_at) VALUES (?,?,?,FROM_UNIXTIME(?))",
    [tokenId, user.userId, hash(token), decoded.exp]
  );
  return token;
}

export async function revokeRefreshToken(token?: string) {
  if (!token) return;
  await db.execute("UPDATE refresh_tokens SET revoked_at=NOW() WHERE token_hash=? AND revoked_at IS NULL", [hash(token)]);
}

export async function rotateRefreshToken(token: string) {
  const payload = jwt.verify(token, config.refreshSecret) as AuthUser & { tokenId: string };
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute<any[]>(
      "SELECT rt.refresh_token_id,u.username,u.role,u.full_name,u.email,u.must_change_password,u.credential_version FROM refresh_tokens rt JOIN users u ON u.user_id=rt.user_id WHERE rt.token_hash=? AND rt.revoked_at IS NULL AND rt.expires_at > NOW() AND u.is_active=1 FOR UPDATE",
      [hash(token)]
    );
    if (!rows.length || (payload.credentialVersion ?? 0) !== rows[0].credential_version) {
      throw Object.assign(new Error("Refresh token is invalid or revoked"), { status: 401 });
    }
    const user: AuthUser = { userId: payload.userId, username: rows[0].username, role: rows[0].role, credentialVersion: rows[0].credential_version };
    await assertResidentApproved(user, connection);
    const replacementId = randomUUID();
    const replacement = jwt.sign({ ...user, tokenId: replacementId }, config.refreshSecret, { expiresIn: config.refreshTtl } as SignOptions);
    const decoded = jwt.decode(replacement) as { exp: number };
    await connection.execute(
      "INSERT INTO refresh_tokens(refresh_token_id,user_id,token_hash,expires_at) VALUES(?,?,?,FROM_UNIXTIME(?))",
      [replacementId, user.userId, hash(replacement), decoded.exp]
    );
    await connection.execute(
      "UPDATE refresh_tokens SET revoked_at=NOW(),replaced_by_token_id=? WHERE refresh_token_id=?",
      [replacementId, payload.tokenId]
    );
    await connection.commit();
    return { accessToken: createAccessToken(user), refreshToken: replacement, user: { ...user, fullName: rows[0].full_name, email: rows[0].email, mustChangePassword: Boolean(rows[0].must_change_password) } };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const token = req.header("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return res.status(401).json({ message: "Authentication required" });
  try {
    const payload = jwt.verify(token, config.accessSecret) as AuthUser;
    const [rows] = await db.execute<any[]>("SELECT user_id,username,role,must_change_password,credential_version FROM users WHERE user_id=? AND is_active=1 LIMIT 1", [payload.userId]);
    if (!rows[0]) return res.status(401).json({ message: "Account is inactive or no longer exists" });
    if ((payload.credentialVersion ?? 0) !== rows[0].credential_version) return res.status(401).json({ message: "Your session has ended. Sign in again." });
    await assertResidentApproved({userId:rows[0].user_id,username:rows[0].username,role:rows[0].role});
    if (rows[0].role === 'Resident' && !['/api/auth/me', '/api/auth/profile', '/api/auth/change-password', '/api/flood-reports', '/api/community-support/mine'].includes(req.originalUrl.split('?')[0]!.replace(/\/$/, ''))) {
      return res.status(403).json({ message: "Resident accounts cannot access staff resources." });
    }
    if (rows[0].role === 'Secretary' && !['/api/auth/me', '/api/auth/change-password'].includes(req.path) && !req.path.startsWith('/api/resident-registrations')) {
      return res.status(403).json({ message: "Secretary accounts can review resident registrations only." });
    }
    if (rows[0].must_change_password && !['/api/auth/change-password', '/api/auth/me'].includes(req.path)) {
      return res.status(403).json({ message: "Change your temporary password before continuing.", code: "PASSWORD_CHANGE_REQUIRED" });
    }
    req.user = { userId: rows[0].user_id, username: rows[0].username, role: rows[0].role, credentialVersion: rows[0].credential_version };
    next();
  } catch (error) {
    if ((error as any)?.status === 403) return res.status(403).json({message:(error as Error).message});
    res.status(401).json({ message: "Invalid or expired access token" });
  }
}

export const requireRoles = (...roles: Role[]) =>
  (req: AuthRequest, res: Response, next: NextFunction) =>
    req.user && roles.includes(req.user.role) ? next() : res.status(403).json({ message: "Insufficient permission" });

export async function requireValidatedResident(req: AuthRequest, res: Response, next: NextFunction) {
  if (req.user?.role !== 'Resident') return res.status(403).json({ message: "Only validated resident accounts can submit flood reports." });
  try {
    const [rows] = await db.query<any[]>(
      "SELECT r.resident_id,r.full_name,r.contact_number FROM resident_accounts a JOIN residents r ON r.resident_id=a.resident_id JOIN households h ON h.household_id=r.household_id WHERE a.user_id=? AND r.record_status='Active' AND h.verification_status='Verified' AND NOT EXISTS(SELECT 1 FROM resident_registrations s WHERE s.user_id=a.user_id AND s.status!='Approved')", [req.user.userId]
    );
    if (!rows[0]) return res.status(403).json({ message: "Your registration must be approved and linked to an active resident in a verified household before you can submit a flood report." });
    req.resident = rows[0];
    next();
  } catch (error) { next(error); }
}
