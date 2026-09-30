# BantayBaha Manual Acceptance Checklist

Use a MySQL 8.4 database initialized with `backend/sql/schema.sql`, configure `backend/.env`, run `npm run seed`, then start both projects.

## Authentication and accounts

- [ ] Public Home, Live Map, and Flood Reports pages open without authentication.
- [ ] Each seeded local-authority role can sign in.
- [ ] Invalid credentials show a generic error.
- [ ] Refresh restores an authenticated session and rotates the refresh token.
- [ ] Logout revokes the refresh token.
- [ ] Forgot-password responses do not disclose whether an account exists.
- [ ] A valid reset link changes the password and revokes existing refresh tokens.
- [ ] Only Super Admin can list and manage accounts.
- [ ] Password hashes never appear in API responses.
- [ ] The current user and final active Super Admin cannot be deactivated.

## Residents and households

- [ ] Super Admin and Data Encoder can create and update households and residents.
- [ ] Disaster Officer cannot access household or resident administration APIs.
- [ ] Future birth dates, invalid contact numbers, duplicate residents, and missing households are rejected.
- [ ] Resident age is calculated from date of birth.
- [ ] Household member count, zone risk, and evacuation status are calculated.
- [ ] Search, sorting, and pagination return correct metadata.

## Flood reports and uploads

- [ ] An anonymous resident can submit a report with location and description.
- [ ] JPEG and PNG signatures, extensions, 5 MB per-file limit, and five-file limit are enforced.
- [ ] Submitted reports enter the authenticated review queue.
- [ ] Validation requires notes and at least one affected zone.
- [ ] Only validated reports appear in public feeds and maps.
- [ ] Public report responses never include reporter identity, contact details, or validation notes.
- [ ] Public photos are available only for validated reports.

## Maps and evacuation support

- [ ] Maps center on 13.7795, 122.8708 and visibly attribute OpenStreetMap.
- [ ] Zones, stations, shelters, routes, and validated reports render in Leaflet.
- [ ] Map data refreshes every 30 seconds.
- [ ] Role permissions are enforced for zones, stations, shelters, volunteers, routes, and emergency contacts.
- [ ] Shelter occupancy cannot be negative or exceed capacity.
- [ ] On a phone, tapping a configured barangay zone places or moves a report pin; Clear removes it, and an out-of-zone tap shows a useful error.
- [ ] Road map opens first on live maps and report pickers; Satellite keeps the current pin and labels.
- [ ] Map data failures show Retry while loaded tiles remain usable; zoom stops before unavailable close-up tiles.
- [ ] Layer controls wrap without icon/label overlap, and older saved coordinate labels are shown without raw numbers.
- [ ] The mobile admin sidebar covers the map with a backdrop and closes when its backdrop is selected.

## Notifications and decision support

- [ ] Super Admin and Disaster Officer can create, edit, send, archive, and mark notifications read or unread.
- [ ] Affected-zone notifications require at least one zone.
- [ ] Public and affected-zone advisories display without authentication.
- [ ] Overall risk follows the Low/Medium/High calculation in the PRD.
- [ ] Zone breakdown and evacuation-priority views use validated reports only.
- [ ] Editing a draft loads its saved message and affected zones; Send saves current edits before delivery.
- [ ] Affected-zone advisories require zone selections, while other audiences do not; invalid fields show inline errors and receive focus.

## Filters and recovery

- [ ] Flood Report, Resident, and Household filters open within the phone viewport with a backdrop; Apply and Reset close the panel and update the active filter count.
- [ ] Super Admin can generate a temporary password once, give it to the account holder, and invalidate earlier sessions.
- [ ] The account holder must replace a temporary password before accessing admin pages. An emailed reset link still works when SMTP is configured.

## Operational and responsive behavior

- [ ] Running `npm run seed` repeatedly creates no duplicates.
- [ ] Seeded information is visibly fictional and production does not seed automatically.
- [ ] Public and administration pages remain usable at mobile and desktop widths.
- [ ] Frontend and backend production builds complete successfully.

## Current automated verification

- Frontend Angular production compilation: passing.
- Backend TypeScript strict compilation: passing.
- Isolated MySQL preview smoke checks: report pin placement and satellite retention; all three filter panels and Household Apply/Reset; notification edit, send, and archive; temporary password sign-in, forced change, and previous-session rejection.
- Full manual acceptance on a physical phone and the deployed SMTP service remains to be checked.
