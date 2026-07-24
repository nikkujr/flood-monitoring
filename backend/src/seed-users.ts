import { createHash } from "node:crypto";
import bcrypt from "bcryptjs";
import { db } from "./db.js";

const deterministicId = (value: string) => {
  const hex = createHash("sha256").update(value).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20)}`;
};

const password = process.env.SEED_DEFAULT_PASSWORD ?? "password";

const passwordHash = await bcrypt.hash(password, 12);
const users = [
  {
    key: "super-admin",
    fullName: "System Super Admin",
    username: "admin",
    email: "admin@bantaybaha.com",
    role: "Super Admin"
  },
  {
    key: "disaster-officer",
    fullName: "Municipal Disaster Officer",
    username: "officer",
    email: "officer@bantaybaha.com",
    role: "Disaster Officer"
  },
  {
    key: "data-encoder",
    fullName: "Community Data Encoder",
    username: "encoder",
    email: "encoder@bantaybaha.com",
    role: "Data Encoder"
  }
] as const;

for (const user of users) {
  await db.execute(
    `INSERT INTO users(user_id,full_name,username,email,password_hash,role,is_active)
     VALUES(?,?,?,?,?,?,1)
     ON DUPLICATE KEY UPDATE
       full_name=VALUES(full_name),
       password_hash=VALUES(password_hash),
       email=VALUES(email),
       role=VALUES(role),
       is_active=1`,
    [
      deterministicId(user.key),
      user.fullName,
      user.username,
      user.email,
      passwordHash,
      user.role
    ]
  );
}

console.log("User seed data is ready: admin, officer, encoder.");
await db.end();
