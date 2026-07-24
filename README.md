# BantayBaha

Community-based flood monitoring and evacuation support for Barangay Colacling, Lupi, Camarines Sur.

## Projects

- `frontend` — Angular 22 administration and public web experience
- `backend` — Express 5, TypeScript, MySQL, JWT authentication, uploads, and seed data
- `backend/sql/schema.sql` — database schema
- `PRD.md` — approved product requirements
- `docs/MANUAL_ACCEPTANCE.md` — PRD acceptance checklist

## Local setup

Requirements: Node.js 26+, npm 11+, and MySQL 8.4 LTS.

1. Start MySQL 8.4. Alternatively, copy the root `.env.example` to `.env` and run `docker compose up -d mysql`.
2. Copy `backend/.env.example` to `backend/.env` and set secrets and database credentials.
3. From `backend`, run `npm install`, `npm run db:init`, `npm run seed`, and `npm run dev`.
4. From `frontend`, run `npm install` and `npm start`.
5. Open `http://localhost:4200`. The API listens on `http://localhost:3000`.

The seed command is idempotent and requires a `SEED_DEFAULT_PASSWORD` of at least 12 characters.

`npm run db:init` safely creates missing schema objects and applies compatibility cleanup. To
delete all data and rebuild the database from the current schema, explicitly confirm the reset:

```powershell
$env:ALLOW_DB_RESET="true"
npm run db:fresh
```

To seed only authority accounts, run `npm run seed:users` from `backend`. It creates or
reactivates these development accounts without overwriting their passwords on subsequent runs:

- `admin` — Super Admin
- `officer` — Disaster Officer
- `encoder` — Data Encoder
