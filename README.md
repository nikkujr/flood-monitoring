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
5. Open `http://localhost:4200`. The development API listens on `http://localhost:3001` (set `PORT=3001` in `backend/.env`).

The seed command is idempotent and requires a `SEED_DEFAULT_PASSWORD` of at least 12 characters.

For an existing production database, back it up first, then run the migration from the
deployed site directory (which contains `.env`, `dist/`, and `sql/`):

```powershell
node dist/migrate.js
```

The migration requires an explicit `DATABASE_URL` and an existing database with a `users`
table. It creates missing schema objects and applies compatibility changes without seeding
demonstration data or dropping `monitoring_stations`. In a development checkout, use
`npm run db:migrate` from `backend` instead. The database user needs permission to create
tables and alter existing tables. MySQL schema changes commit as they run, so keep a backup
in case a later step fails.

`npm run db:init` is for local setup and also runs the demonstration seed. To
delete all data and rebuild the database from the current schema, explicitly confirm the reset:

```powershell
npm run db:fresh
```

Run the production migration before deploying account recovery changes. Existing databases receive
`users.must_change_password` and `users.credential_version` without resetting account data.
For emailed password resets in production, configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`,
`SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, and the public `PASSWORD_RESET_URL` in the backend
environment. Port 465 normally uses `SMTP_SECURE=true`; port 587 normally uses `false`. The
application intentionally cannot send mail while `SMTP_HOST` is blank. A Super Admin can generate
a one-time temporary password when email delivery is unavailable; the account holder must change
it at the next sign-in.

## SMARTERASP.NET deployment package

Run `./build-smarterasp.ps1` from PowerShell to produce a single-site deployment under
`deploy/smarterasp`. The package serves the Angular application at `/` and the Express API
at `/api` through IIS `httpPlatformHandler`.

Before uploading, create a production `.env` from the generated `.env.example` and enter
the database, JWT, and SMTP secrets. Never upload placeholder values as live credentials.
Import the database dump separately through the hosting database tools; the dump is
intentionally excluded from the web package.

To seed only authority accounts, run `npm run seed:users` from `backend`. It creates or
reactivates these development accounts without overwriting their passwords on subsequent runs:

- `admin` — Super Admin
- `officer` — Disaster Officer
- `encoder` — Data Encoder
