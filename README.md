# BantayBaha

Approved residents can submit **Need help**, **Safe at home**, or **Reached shelter** check-ins under **My Account → Check-ins & help**, with their current location and assistance needs. Staff use **Requests & Follow-up** (`/admin/contacts`) to review requests and record household outreach, staff assignments, and follow-up history. The dashboard counts open requests for help. Check-ins do not change evacuation status, shelter occupancy, or rescue assignments; staff use the existing planner for those confirmed actions. An unresolved request for help prevents duplicate help requests; safe/shelter check-ins do not close it. Household contact status persists until staff explicitly update it; this version has no incident-based reset.

Before deploying assistance/contact tracking, run `npm run db:migrate` from `backend` to create the four additive tables without resetting records. Verify against a running local API with `node --import tsx src/community-support.integration.test.ts` (set `PORT` to the API port); fixtures are created and removed automatically.

Residents can self-register at `/register` with their name, birth date, contact, address, optional household number, email, username, and password. Registration creates a **Pending** request without signing the resident in. Residents can sign in only after validation and approval; pending and rejected accounts cannot log in or refresh an existing session. The **Secretary** reviews registrations in **Resident Approvals**, validates identity and household membership, uses the resident table lookup to link an active registry resident in a **Verified** household, and approves or rejects with notes. If the applicant is a new resident, the secretary can choose **Add a new resident and approve**, confirm the prefilled personal details, select a verified household, sex and priority, and save the new resident, account link and approval in one transaction. Existing name/birth-date/household duplicates are rejected. Decisions record the reviewer and time. Super Admins create Secretary accounts in **User Accounts** and also have access to the approval queue. Public registration never exposes the resident registry or lets applicants select their own role or approval status.

Flood reports require a signed-in **Resident** account linked to an active resident in a **Verified** household; self-registered accounts additionally require **Approved** status. Super Admins can still provision validated resident accounts directly; those initial passwords must be changed at first sign-in. **My Account** (`/my-account`) shows approval status, personal information, household membership, and password changes. Residents can edit their name, birth date, sex, email, contact number, residential address, marital status, occupation, education, emergency contacts, PhilSys and PhilHealth numbers, sanitary toilet, type of house, PWD details, swimming ability and solo-parent status from **My Account**. Tabs group personal information, household, check-ins/help and security; cards expand or collapse. Updates apply only to their linked record, keep the account name/email in sync, and validate duplicate identities and contact details. Household membership, approval, roles, priority and evacuation status remain under barangay control. Public maps and validated reports remain accessible to visitors.

Run `npm run db:migrate` before deploying this change to add resident registrations, resident account links, the Resident and Secretary roles, and reporter account attribution. Existing accounts and reports remain intact. Repeat the local API checks from `backend` with `node --import tsx src/resident-account.integration.test.ts` and `node --import tsx src/resident-registration.integration.test.ts`.

Community-based flood monitoring and evacuation support for Barangay Colacling, Lupi, Camarines Sur.

## Projects

- `frontend` — Angular 22 administration and public web experience
- `backend` — Express 5, TypeScript, MySQL, JWT authentication, uploads, and seed data
- `backend/sql/schema.sql` — database schema

Existing installations need the rescue-mission migration before deploying the response workflow: run `npm run db:migrate:rescue` from `backend` (or `node dist/migrate-rescue.js` after compilation). It creates the four rescue tables without seeding or modifying resident records. The full schema migration also includes these tables. In DSS, choose **Plan evacuation & rescue**, open **Teams** to register a crew (vehicle optional), open **Choose residents** to select a group, send the team, record updates in **Missions**, then confirm physical shelter arrival. Missing/deceased reports have their own view.

Then run `npm run db:migrate:responders-outcomes` (or `node dist/migrate-responders-outcomes.js`) to add registered volunteer/tanod membership and resident outcome history. Both migrations are additive and repeatable; the full schema migration also includes these changes. Existing volunteers default to Volunteer; classify barangay tanods in **Shelters & Responders → Volunteers & Tanods**. Existing rescue teams need a registered crew and leader before dispatch. Rerun the latest `db:migrate:rescue` on installations that already have rescue tables to allow a null vehicle; existing vehicle identifiers and unique constraints are preserved. Choose **Use a vehicle** only when one is involved; passenger spaces are required and enforced for vehicle crews, while on-foot crews have no vehicle seat limit. Officials confirm whether the route and assistance method suit the selected residents. In DSS, **Missing & deceased residents** records sourced, confirmed outcomes and corrections while preserving the registry; Deceased outcomes and their corrections require a Disaster Officer or Super Admin. Missing/Deceased residents cannot receive ordinary evacuation placement or confirmed shelter arrival.
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

Staff can dispatch a rescue team from **Requests & Follow-up → Arrange rescue** for an open request for help. Confirm the need for rescue, choose a destination, then check an available team, pickup, route and assistance method in the existing dispatch dialog. The request is acknowledged with an audited mission reference and remains open until staff resolve it; dispatch does not mark the resident evacuated. Stale/closed requests and mismatched residents are rejected alongside existing mission safeguards.

Operational workspaces use searchable tables: Requests & Follow-up, rescue teams/missions/outcomes, and Shelters & Responders. Rescue lists are server-paged at 20 records, support status filters and sorting, and load history only in record details. Select **Completed** or **All stages** in Missions to browse older records. Dispatch rosters load when needed; periodic refreshes retain the complete active resident assignment list.

The current year in Residents reads the live registry without rebuilding annual archives. A Super Admin can choose **Capture annual archive**, then confirm replacement of the current year's archive. Capture the final annual record before year end; existing past-year archives and historical imports stay unchanged.
