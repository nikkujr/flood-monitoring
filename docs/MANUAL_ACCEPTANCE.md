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
- [ ] On the current resident year, Super Admin and Data Encoder can download a CSV template, choose a file, validate it, and import up to 500 residents linked by existing household numbers.
- [ ] A malformed CSV, invalid date or priority, duplicate resident, invalid contact number, or missing household displays a row error and saves no residents from the batch.
- [ ] Imports never overwrite existing profiles and are unavailable in historical years or to Disaster Officers.

## Appearance

- [ ] Public navigation, sign-in, and the admin header offer System, Light, and Dark themes; the selection survives reload.
- [ ] System follows the operating system appearance, including changes while the application is open.
- [ ] Check cards, tables, filters, forms, dialogs, map controls, and statistics for readable text in both themes, on desktop and mobile.
- [ ] Keyboard focus stays visible; the resident import dialog supports Tab, Shift+Tab, Escape, and restores focus to its trigger when closed.
- [ ] Public and admin forms use consistent control sizes, headings, labels, and Save/Cancel spacing; mobile inputs remain readable without automatic zoom.
- [ ] Safe/active/verified statuses use green, monitoring/pending statuses use amber, and full/rejected statuses use red; inactive and unknown statuses remain neutral.
- [ ] Failed record loads display Retry instead of an empty-results message; successful retries clear the earlier error. Empty searches suggest adjusting the search or filters.
- [ ] Pagination labels identify Previous/Next, announce the current page, and disable navigation during loading.
- [ ] Resident editing groups all fields into Personal, Household, Health, Emergency Contact, and Priority/Evacuation sections, with required fields marked and Save/Cancel visible while scrolling.
- [ ] Record tables show short references with full IDs available through their labels/tooltips; active navigation and category buttons expose their selection to assistive technology.
- [ ] Search and applied filters appear as individually removable chips; Clear all resets both search and filters.
- [ ] Closing a changed editor asks whether to keep editing or discard; keeping edits preserves entered values, successful saves close directly, and keyboard focus returns to the opener.
- [ ] Polygon, location, and household changes count as unsaved edits; refreshing a page with unsaved edits triggers the browser warning.
- [ ] Dashboard occupancy highlights near-capacity centers at 80% and full centers at 100%; report reviewers can see the pending review count.

Run the small admin presentation check from the repository root:

```powershell
node backend/node_modules/tsx/dist/cli.mjs frontend/src/app/admin-ui.spec.ts
```

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
- [ ] Admin search fields have one border with no overlapping input; pagination buttons remain on one row. Run `frontend/scripts/check-admin-toolbar.js` in the browser console on a records page at desktop and phone widths.
- [ ] Sidebar destinations are grouped; category and statistics tabs wrap visibly on phones.
- [ ] Resident and evacuation-center wizards validate before Next, preserve entries with Back, reveal invalid steps when saving, and warn before discarding changes. Run `frontend/scripts/check-admin-wizard.js` with a long editor open at desktop and phone widths; Back/Next must stay within the dialog.
- [ ] Wizards require Review and save before submission; Edit returns to the selected section and the review refreshes with corrected entries. Phones show the current step with an expandable step list.
- [ ] Dashboard Needs attention opens Submitted/Under Review reports, residents marked For Evacuation, and center capacity management. Counts exclude inactive residents and inactive/unavailable centers.
- [ ] Clicking a barangay zone or selecting it from the zone chooser reveals the existing DSS assessment, recorded population coverage, and center availability. Zone resident/report/evacuation links apply the selected zone filter; unknown population and availability stay visibly unknown.
- [ ] Frontend and backend production builds complete successfully.
- [ ] Missing or invalid dashboard attention counts show unavailable instead of NaN, while a valid zero stays 0. Risk banners, severity symbols, and alert descriptions remain readable in dark mode; run `node frontend/scripts/check-risk-contrast.cjs`.

## Current automated verification

- Frontend Angular production compilation: passing.
- Backend TypeScript strict compilation: passing.
- Isolated MySQL preview smoke checks: report pin placement and satellite retention; all three filter panels and Household Apply/Reset; notification edit, send, and archive; temporary password sign-in, forced change, and previous-session rejection.
- Full manual acceptance on a physical phone and the deployed SMTP service remains to be checked.

### Assessment filter backdrop
- Open Reports & Statistics → Assessment filters. Verify that the background dims and background controls cannot receive focus.
- Change a selection and dismiss using the backdrop, Cancel, close button, or Escape. Verify that applied filters remain unchanged, focus returns to the trigger, and reopening restores the applied selection.
- Apply a selection. Verify the dialog closes, the assessment refreshes, and the active filter chip/count updates. Reset clears the applied filters.
- Repeat in light/dark mode and at 390px width. Verify readable controls, scrolling when needed, and no horizontal overflow.

### Record filter backdrops
- Repeat the assessment backdrop dismissal/apply checks for Flood Reports, Residents, and Households.
- Verify reopened filters restore the applied selection, including Any vulnerability for residents; Reset clears the filters.
- At desktop and 390px widths, open each dialog and run frontend/scripts/check-filter-dialog.js in the browser console. Verify light/dark appearance and return of focus to the trigger after closing.

### Risk evidence and printable situation report
- In Reports & Statistics → Zone assessment, expand Why [risk]? for each zone. Verify the matched rule, count explanation, tracking codes, severities, and report dates; unverified/resolved/rejected reports must not contribute.
- Open Situation report. Verify the assessment timestamp uses Philippine time and applied filters are shown. Verify every active validated incident is included (including more than ten), and each incident is listed once even if linked to multiple zones.
- Verify unknown population/occupancy values remain Unknown and missing-zone/population notes appear. Test a selection with no active incidents and a selection with no zones.
- Leave the report preview open through an automatic analytics refresh. Verify the preview timestamp/content remain fixed. Return to analytics and verify focus returns to Situation report.
- Use Print / Save PDF in a browser supporting printing. Verify A4 output hides navigation and controls, repeats table headings, fits columns, and preserves report rows across pages. Verify mobile preview scrolls tables without horizontal page overflow.

### Household families and flood-report review
- Households → View family: verify registered members, relationship, vulnerability, assistance considerations, status, and recorded evacuation center. Test empty/error/loading states, Escape/outside dismissal, and 390px width.
- Open member list must show current-year resident records filtered to that household.
- Flood Reports → Review: confirm current status, existing notes, and review history load before saving. Only allowed next decisions should appear. Validation/resolution require affected zones; rejection/resolution require reviewer notes.
- Verify each saved review adds a timestamped reviewer entry without replacing earlier entries. Rejected/resolved reports can reopen Under Review. Existing pre-feature reviews are not backfilled; earlier notes remain visible.
- Open the same report in two sessions. Change its status in one session; saving the stale status in the other must fail without overwriting the first review. Close/reopen to reload.
- Deployment: run the backend db:migrate:report-reviews script (or the normal schema migration) before serving the updated report endpoints. The review-history migration was applied to the local database.

### Follow-up verification (October 7, 2026)
- Passed against the running local API and MySQL: review-history retention, reviewer/zone snapshots, preservation of the original validation timestamp, required resolution notes, stale-status rejection without overwriting the latest decision, and reopening completed reports. The test creates and removes only its own report.
- Repeat from the backend directory, with the local API running: `node node_modules/tsx/dist/cli.mjs src/report-review.integration.test.ts`.
- Passed with real API data at 390px: household details and member counts, household/resident/report/assessment filter bounds, Escape and focus return for household filters, and situation-report preview without horizontal page overflow.
- Passed resident wizard checks: empty required fields block Next and receive focus; Back and Keep editing preserve changes; Review includes changed values; Discard removes unsaved edits. No existing resident records were saved during verification.
- Passed evacuation-center wizard checks: required-field validation, all steps through Review, readable dark-mode phone layout, and desktop Save controls within the viewport. No existing centers were saved during verification.
- Fixed long-name overflow in the admin header. Local backend allowed origins now include the preview at port 4317. The development API uses port 3001 to avoid an unrelated Docker service on 3000; use `PORT=3001` in `backend/.env` and restart the API after changing development configuration.
- Removed the temporary UI-verification account and its refresh sessions, restored the browser viewport, and restored the preview theme to System.
- Still unverified: final A4 PDF pagination/output, physical-phone behavior, and deployed SMTP delivery. The in-app browser's native print dialog was inaccessible to automation; this is not a successful PDF verification.

### Browser drafts and record readiness
- Record editors and the public flood-report form save text, selections, map coordinates, polygons, and wizard position in this browser. Drafts expire after 7 days, are separated by signed-in user/resource/record, and remain after a failed request. Passwords and file contents are excluded; reattach photos after refreshing. Successful saves remove the draft.
- Reopen a form and choose Resume draft or Discard draft. Close a changed editor with Keep draft and close, then reopen it. Verify all wizard steps, household selection, empty/multiple zone selections, and map pin recover correctly. Resume a report draft after another reviewer changes its status: it must refuse restoration and ask for a fresh review.
- Automated draft-storage checks passed: strings/multiple selections, account/form isolation, expiration, corrupt/unavailable/full storage, password/photo exclusion, and removal. Public browser checks passed for text/selections across refresh and page navigation, and retention after failed location validation.
- Resident profiles show current household, contacts, vulnerability, evacuation status/center, and timestamped assignment history. Historical resident snapshots retain their existing read-only behavior.
- Household readiness flags count only active members: incomplete emergency contact, evacuation status requiring a center but none recorded, and assistance considerations (recorded vulnerability, high priority, or inability to swim). These are record checks, not a prediction of safety or guaranteed assistance.
- Dashboard data-quality cards link to incomplete resident basics, emergency-contact gaps, missing center assignments, pending flood-report reviews, and validated reports missing affected zones. Counts can overlap. Data Encoders do not receive flood-report drilldown controls.
- Readiness helper checks and authenticated API integration checks passed, including all five count/filter comparisons, profile/family consistency, and unauthenticated access rejection. Repeat from backend: `node node_modules/tsx/dist/cli.mjs src/record-readiness.integration.test.ts`.
- Development API requests use the preview's hostname on port 3001, so localhost/127.0.0.1 previews keep refresh-cookie requests on the same site.
- Admin browser checks passed using the user's existing sign-in: refresh preserves session, personal fields and wizard step; Keep draft and close retains entries; Discard draft clears them; a rejected household save retains all fields after refresh; a successful save clears the draft. The sole temporary household was removed afterward; existing records were not saved or deleted.
- Resident profile, edit handoff, household readiness and assistance/contact counts, and a data-quality card's matching resident filter passed browser checks. Profile/family dialogs fit at 390px without internal horizontal overflow. Public-report controls were constrained to their grid cells to prevent phone overflow. Browser screenshots are saved alongside the earlier verification images.
- Fixed resident birth dates shifting one day between profiles and editors: calendar dates now remain YYYY-MM-DD strings in current records and annual snapshots. Integration checks compare both endpoints with the profile date.
- Still pending: actual network interruption (failure handlers retain the form/draft), full report draft stale-status/map/multiple-zone browser scenarios, physical phone and PDF checks as above.

### DSS bulk resident status
- DSS -> Zone assessment -> Critical zone -> Mark residents: review the whole-zone count, choose Safe / For Monitoring / For Evacuation, then confirm. Active residents already carrying the selected status are skipped; evacuated and inactive residents remain unchanged. DSS filters do not narrow the bulk action.
- The action follows existing resident-write permissions (Super Admin, Disaster Officer, Data Encoder). Marking Evacuated still requires the evacuation-center assignment workflow.
- The backend checks current unfiltered Critical risk and a revision of resident/report evidence inside a transaction. A changed preview or a zone that is no longer Critical rejects the entire request; reopen the action to obtain current counts.
- The DSS population assessment now excludes inactive resident records, matching bulk-action eligibility.
- Database integration checks passed with temporary, rolled-back fixtures: all three statuses, no-op updates, stale previews, risk downgrades, zone isolation, evacuated/inactive preservation, and invalid status/revision rejection. Repeat from backend: `node node_modules/tsx/dist/cli.mjs src/dss-zone-status.integration.test.ts`.
- Backend TypeScript checking and frontend production compilation passed. Browser confirmation/focus/mobile interaction remains unverified.
- Individual selection: Mark residents opens with no residents selected. Check one or several resident rows, or use Mark all eligible residents; the master checkbox shows a partial selection and can clear all selections. The selected/change totals and proposed row actions follow the selection and chosen status. Inactive/evacuated checkboxes are disabled. Confirm remains disabled when the selection causes no changes.
- Selection integration checks passed: one, several, and all eligible residents; unselected status preservation; duplicate IDs deduplicated; empty/malformed selections rejected; mixed selections containing evacuated, inactive, missing, or other-zone residents reject without partial updates. Browser checkbox/focus/mobile verification remains pending.
- Every DSS zone now has View residents, showing all zone residents by name/household, current evacuation status, and Active/Inactive record status in a read-only dialog. Non-Critical and empty zones can be viewed; marking remains restricted to current Critical zones. Database checks verify High/Low/empty views and that viewing changes no statuses; non-Critical writes are still rejected. Backend type checks and frontend production compilation passed; browser interaction remains pending.
- Main Residents page: current-year rows now provide Delete alongside Profile and Edit for users who can manage resident records. Confirmation names the selected resident; Cancel sends no request. Existing editor deletion shares the same handler. Historical rows remain read-only. Handler checks pass for row identity, editor reuse, cancellation, permissions/history/loading guards, and backend-error retention (`node scripts/check-resident-delete.cjs` from frontend); frontend production build passes. No operational residents were deleted during verification. Live browser deletion remains unverified.
