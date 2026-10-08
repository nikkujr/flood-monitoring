import type { Request } from "express";

export type Role = "Super Admin" | "Disaster Officer" | "Data Encoder" | "Resident" | "Secretary";
export interface AuthUser {
  userId: string;
  username: string;
  role: Role;
  credentialVersion?: number;
}
export interface AuthRequest extends Request {
  user?: AuthUser;
  resident?: { resident_id: string; full_name: string; contact_number: string | null };
}
