import "dotenv/config";
import { resolve } from "node:path";

const required = (name: string, fallback?: string) => {
  const value = process.env[name] ?? fallback;
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
};

export const config = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: required("DATABASE_URL", "mysql://root:password@localhost:3306/bantay_baha"),
  frontendOrigins: (process.env.FRONTEND_ORIGINS ?? "http://localhost:4200").split(",").map((v) => v.trim()),
  accessSecret: required("JWT_ACCESS_SECRET", process.env.NODE_ENV === "production" ? undefined : "development-access-secret-change-before-production"),
  refreshSecret: required("JWT_REFRESH_SECRET", process.env.NODE_ENV === "production" ? undefined : "development-refresh-secret-change-before-production"),
  accessTtl: process.env.JWT_ACCESS_TTL ?? "15m",
  refreshTtl: process.env.JWT_REFRESH_TTL ?? "7d",
  uploadRoot: resolve(process.env.UPLOAD_ROOT ?? "storage/uploads"),
  frontendDistRoot: resolve(process.env.FRONTEND_DIST_ROOT ?? "public"),
  defaultPageSize: Number(process.env.DEFAULT_PAGE_SIZE ?? 20),
  maxPageSize: Number(process.env.MAX_PAGE_SIZE ?? 100),
  refreshCookieDomain: process.env.REFRESH_COOKIE_DOMAIN,
  refreshCookiePath: process.env.REFRESH_COOKIE_PATH ?? "/api/auth",
  refreshCookieSameSite: (process.env.REFRESH_COOKIE_SAME_SITE ?? (process.env.NODE_ENV === "production" ? "none" : "lax")) as "lax" | "strict" | "none",
  refreshCookieSecure: process.env.REFRESH_COOKIE_SECURE ? process.env.REFRESH_COOKIE_SECURE === "true" : process.env.NODE_ENV === "production",
  refreshCookieMaxAgeMs: Number(process.env.REFRESH_COOKIE_MAX_AGE_MS ?? 604800000),
  smtpHost: process.env.SMTP_HOST,
  smtpPort: Number(process.env.SMTP_PORT ?? 587),
  smtpSecure: process.env.SMTP_SECURE === "true",
  smtpUser: process.env.SMTP_USER,
  smtpPassword: process.env.SMTP_PASSWORD,
  smtpFrom: process.env.SMTP_FROM ?? "BantayBaha <no-reply@bantaybaha.local>",
  passwordResetUrl: process.env.PASSWORD_RESET_URL ?? "http://localhost:4200/reset-password",
  isProduction: process.env.NODE_ENV === "production"
};
