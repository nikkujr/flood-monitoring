import type { Request } from "express";

export type Role = "Super Admin" | "Disaster Officer" | "Data Encoder";
export interface AuthUser {
  userId: string;
  username: string;
  role: Role;
}
export interface AuthRequest extends Request {
  user?: AuthUser;
}
