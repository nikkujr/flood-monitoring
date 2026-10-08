# BantayBaha Manual Acceptance Checklist

## Resident check-ins and household contact tracking — October 9, 2026

- Approved residents submit Need help, Safe at home, or Reached shelter from My Account → Check-ins & help. Require a current location; help requests also require assistance details. Identity and household come from the account. Resident history is private to its linked resident.
- Pending/rejected, inactive, unlinked, and temporary-password accounts cannot submit. Residents and Secretaries cannot read staff assistance/contact queues. Super Admin, Disaster Officer, and Data Encoder can review requests and record household contacts.
- Requests for help appear in the dashboard count and ahead of other check-ins in the queue. A second unresolved help request is rejected, including simultaneous submissions. Safe/shelter check-ins do not close an unresolved help request or change evacuation status/occupancy.
- Review requires notes and confirmation. Acknowledge or close after verification; history retains staff/time/notes. Concurrent or closed-record edits fail without overwriting history. Use the evacuation planner for dispatch and confirmed arrivals.
- Household contacts include verified households with active residents. Search by number, household head, or zone; filter contact status and assign active staff. Uncontacted households appear without needing a saved contact row. Updates retain history and reject stale revisions. Contacts persist until explicitly updated; there is no incident reset yet.
- Automated API check: `node --import tsx src/community-support.integration.test.ts` from backend, with PORT matching the local API. It creates and cleans isolated records. Browser checks on fictional records cover resident submission, staff acknowledgement, household assignment/follow-up, and history. At 390×844, the contact dialog has equal 335px client/scroll widths and no horizontal overflow.
- Deploy with the full additive `db:migrate` before the new backend/frontend. Local tables were created without resetting existing records. Production builds pass with existing frontend bundle/style warnings.

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
- [ ] Wizards require Review and save before submission; Edit returns to the selected section and the review refreshes with corrected entries. Every screen shows the current step with an expandable, bounded step list; short screens keep the action buttons accessible.
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
- In Decision Support (DSS) → Zone assessment, expand Why [risk]? for each zone. Verify the matched rule, count explanation, tracking codes, severities, and report dates; unverified/resolved/rejected reports must not contribute.
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

### Panel presentation rehearsal (October 8, 2026)

- Passed a complete local API workflow using isolated fictional records: anonymous report submission and zone association; reports withheld from the public feed until validated; review and validation history; High then Critical assessment; vulnerable-resident and shelter-shortfall recommendations; individual monitoring and bulk evacuation marking; atomic rejection when shelter capacity is insufficient; assignment with recorded history; return home with capacity restored. All rehearsal records are removed in the test's cleanup block. Existing residents, reports, and centers are not updated by this test.
- Repeat from `backend` with its local API running: `node node_modules/tsx/dist/cli.mjs src/panel-demo.integration.test.ts`. The configured database must have an active Super Admin. Run against local development, not a production presentation database.
- Fixed the dashboard's legacy spatial-query risk summary to reuse the unfiltered DSS assessment. Its risk, validated-report count, affected-zone count, and assistance count now agree with DSS. Its gauge displays Low / Moderate / High / Critical; failed assessment loads show Unknown and unavailable counts instead of a false Low/zero result.
- Fixed DSS shelter readiness to count active residents actually assigned as Evacuated, matching Evacuation Support rosters; inactive centers are excluded. The workflow test compares all active-center occupancy values with the resident registry. Stored historical occupancy values no longer inflate current availability calculations.
- Browser checks passed with the existing admin session: dashboard shows Critical, 7 validated reports, 4 affected zones, and 33 residents needing assistance, matching DSS; Reports & Statistics opens report analytics; DSS opens response recommendations; Critical-zone search by household narrows 15 residents to 3, filtered Mark all selects those 3, and unchecking one produces 2 selected residents. This browser selection was cancelled without saving.
- Situation-report browser preview passed: fixed assessment timestamp in Philippine time, risk rules and evidence, seven distinct active incident records, shelter readiness, and recommended actions. Browser preview is verified; final A4 PDF pagination and physical-phone behavior remain pending.

Suggested demonstration, using clearly fictional records in a dedicated demo database:

1. **Flood Reports:** show a new report's tracking code and pending review; explain why unverified reports do not raise assessed risk. Review it, select its affected zone, and validate with notes.
2. **DSS → Response overview:** show the changed risk and recommended response. Describe it as decision support from recorded evidence, not a flood forecast.
3. **DSS → Zone assessment:** expand Why [risk]? and show the validated incident evidence and vulnerable population behind the rule. Use a Critical zone to demonstrate resident marking.
4. **Mark residents:** search a household, select one resident, then demonstrate Mark all matching residents. Review proposed status changes before confirming For Evacuation. Explain that inactive and already-evacuated residents are protected.
5. **Evacuation Support:** choose an operational center with capacity, assign selected demo residents, and show their names, status, occupancy, and assignment history. Demonstrate an over-capacity rejection using a small fictional center.
6. **DSS → Situation report:** finish with the assessment timestamp, supporting evidence, available shelter spaces, and recommended actions. Use Print / Save PDF after checking the output on the actual presentation browser.

Before presenting, reconcile legacy duplicate zone labels and the demo centers' zone assignments; the rehearsal found names such as Zone 1 and Zone 1 - Riverside representing separate database records, and some center names/location labels differ from their linked zones. The rehearsal did not merge or rewrite existing data. Fill fictional emergency-contact values where appropriate; the dashboard currently identifies 78 incomplete emergency-contact records.

### Evacuation planner and what-if simulation



- DSS -> Evacuation planner uses all active records, independently of assessment filters. It ranks households by assistance priority, prefers same-zone centers, keeps eligible household members together when space permits, and flags split households, cross-zone transport, and unplaced residents. Full, unavailable, and unknown-capacity centers are excluded. Suggestions do not reserve beds or establish safe routes; field review remains necessary.
- Search the resident list and select individually or mark all matching suggested placements. Review arrivals per center, confirm physical arrival, and record through the existing assignment/history transaction. Changed resident statuses or insufficient current capacity reject the entire batch. Residents explicitly marked For Evacuation stay eligible even in Low zones; evacuated residents are excluded.
- Expand What if? Add up to ten hypothetical validated major reports in one zone and/or close selected centers. The same DSS rules calculate baseline and scenario from one read-only snapshot. Compare zone risk, available spaces, placements, shortfalls, and recommendations. Simulation and pending scenario edits disable arrival recording. Return to live data before operational actions; Live situation report always exports the live assessment.
- Passed backend type checking, risk and scenario checks, deterministic allocation checks, and the expanded API workflow (simulation immutability, unauthorized/invalid requests, stale-status rejection, capacity rejection without partial updates, and assignment history). Repeat pure checks with `src/dss.test.ts`, `src/dss-simulation.test.ts`, and `../frontend/src/app/evacuation-plan.spec.ts` through the backend's tsx runner; API checks use `src/panel-demo.integration.test.ts`.
- Browser checks passed: resident selection and arrival dialog with confirmation disabled until arrival acknowledgement; the dialog was cancelled without saving. Two hypothetical major incidents changed a Low zone to Critical and closing one center reduced capacity from 645 to 495. Simulation disabled resident selections and removed arrival actions. At 390px in dark mode, inputs retained 44px targets and the page had no horizontal overflow; tables scroll internally. Temporary theme and viewport settings were restored. No existing resident status was changed during browser verification.
- Presentation sequence using existing records: show live suggestions and reasons, search a household, open and cancel arrival review, then simulate additional incidents and a closed center to demonstrate the changed response. This is a planning exercise, not a flood forecast. Physical-phone testing and transport/accessibility validation remain field tasks.

### Guided rescue response (October 8, 2026)

- Entry point: DSS -> Plan evacuation & rescue (or Evacuation planner). Four visible steps explain Prepare, Select residents, Send a team, Confirm arrival. Shortcuts jump to team setup and the mission board; an empty team registry opens setup automatically.
- Register/edit one team with one vehicle identifier, leader/contact, and passenger spaces after allowing for crew/equipment. Available, On a mission, and Out of service are displayed. Assigned teams cannot be edited or taken out of service. A unique vehicle identifier prevents assigning the same registered vehicle through a second team.
- Search/select residents, then Send a rescue team for their suggested center. The dialog prefills pickup addresses and assistance flags, lists exact residents/destination, and requires route/transport/destination acknowledgement. Seat limits, active records/statuses, current shelter availability/capacity, team availability, and duplicate resident assignments are checked transactionally. Sending creates a mission without marking residents Evacuated or reserving beds.
- Mission cards show the next action: Team reached pickup -> Residents are on the way -> Confirm shelter arrival. Officials enter updates received by phone/radio/in person; this is not live GPS. Report a problem requires a reason and keeps the mission/team/residents assigned. Resolve then Resume dispatch, or Cancel with a reason to release assignments and prepare a new destination. A transporting mission must first be marked Blocked before cancellation.
- Confirmation requires every listed resident to have physically arrived. Arrival atomically checks current center capacity/availability and active resident eligibility, writes Evacuated status and assignment history, updates center occupancy/status, completes the mission, and releases the team. A stale mission revision or failed capacity check changes nothing. Partial-group arrival is not supported: dispatch manageable groups and confirm only when the entire listed group arrives.
- The live planner labels assigned residents Team assigned and prevents reselection. Awaiting team assignment counts eligible plan residents without a mission, including those lacking suggested shelter space. The board shows active missions, blocked reasons, contact details, update history, and a prompt to contact teams after 30 minutes without an update. This prompt does not infer actual delay. Up to 30 recent completed/cancelled missions show arrivals and dispatch-to-arrival duration, scoped explicitly to the displayed history.
- Simulation shows an explanation beside disabled selections and a Return to live plan action. Dispatch, team changes, and mission updates are disabled while scenario inputs are pending or results are hypothetical. Direct arrival for residents who reached a center independently is under a separate disclosure; active mission residents must use their mission's arrival confirmation.
- Active-mission residents and destinations cannot be deleted. Existing resident/center status changes can still invalidate arrival; the user gets an actionable rejection and must coordinate or cancel/replan. No routing/seat suitability is inferred beyond recorded passenger capacity; officials verify mobility/equipment needs and field conditions.
- Passed `src/rescue.integration.test.ts` through the backend tsx runner: validation/auth rejection, duplicate team/vehicle, team editing, seat limits, concurrent resident assignment, unavailable/busy teams, stale revisions, valid next steps, blocked/resume/cancel, arrival acknowledgement, atomic capacity rejection, real roster/history/center status, resource release, and active-mission deletion/direct-assignment guards. Isolated fixtures clean up in finally. Existing panel workflow tests and TypeScript/production build checks also passed.
- Browser rehearsal passed with temporary fictional residents, center, and team: setup, filtered Mark all, dispatch acknowledgement/prefilled assistance, mission auto-focus, blocked reason, resume, pickup, transport, disabled arrival until acknowledgement, completion metrics and resource release. All fictional records were removed. Existing residents were only viewed; none were dispatched or changed. Dispatch and arrival dialogs fit 390px with internal vertical scrolling, no horizontal overflow, and 44px action targets. Physical-device/official usability acceptance remains to be performed.
- Deployment: `npm run db:migrate:rescue` from backend or `node dist/migrate-rescue.js`; migration is additive. Local tables were created without seeding existing records.

### Registered responders and resident outcomes (October 8, 2026)

- Teams select existing volunteers/barangay tanods and a leader from the selected crew. Registry names/contact details are reused; crew names/types are stored in the mission snapshot. Existing teams without a registered roster show a setup warning and cannot dispatch. Classify existing tanods explicitly; the additive migration defaults older records to Volunteer.
- Dispatch requires every crew member to be Available and free of another active mission. Shared members cannot be dispatched through a second team; arrival/cancellation releases responder assignments. Manual registry availability remains authoritative. An assigned responder cannot be deleted until removed from team rosters after the mission finishes.
- DSS outcome search identifies the exact resident/household. Missing, Deceased, and Located reports require a source, location, observation time, notes, and acknowledgement. Changing the outcome clears the acknowledgement. A Disaster Officer or Super Admin must record/correct Deceased. Stale revisions reject concurrent overwrites, and corrections append history.
- Missing/Deceased clear existing center assignments and release their occupancy. Their registry records/history remain available; ordinary placement, bulk status marking, and arrival confirmation exclude them. Deceased records are excluded from operational DSS population/priority counts. Missing records appear in follow-up, not ordinary evacuation suggestions. Located does not infer Safe/Evacuated or restore a prior shelter assignment.
- A newly recorded outcome flags any existing mission and disables arrival; officials contact the crew and explicitly block/cancel/replan. Outcome history appears in the DSS list and resident profile. Registry deletion is blocked when outcome history exists; use Inactive to preserve records.
- API checks passed: rescue dispatch/concurrency/shared crew, status transitions and shelter occupancy; outcome validation/roles/revisions, observation-time round trip, registry/history preservation; panel workflow, zone marking, DSS rules and simulation regression. Fixtures are isolated and removed/rolled back.
- Browser checks on fictional fixtures passed: team with one Volunteer and one Barangay Tanod, registered tanod as leader, Missing → Located → Deceased with required acknowledgement reset, exact resident search, preserved history, and dispatch using the registered crew. At 390×844, outcome section width/scroll width are both 325px and controls fit without horizontal overflow. Production build/TypeScript pass; existing bundle/style size warnings remain.
- Deployment: run db:migrate:rescue first, then db:migrate:responders-outcomes, or use the full schema migration. Local additive migrations were applied without seeding/resetting actual records.

### Focused rescue navigation and optional vehicles (October 8, 2026)

- The latest workflow replaces the long stacked planner with Choose residents, Missions, Teams, Missing & deceased, and What if views. Only the selected task is shown; assessment filters are hidden here because they do not affect the live plan. A compact DSS section selector replaces the tall sticky section bar inside the planner.
- Residents show five rows per page, with search and an explicit all-search-matches selection count. Paging and switching task views preserve selected IDs. The send action stays in the resident selection panel; successful dispatch switches directly to Missions and clears assigned residents from selection. Teams show five records/page; missions and outcome lists show three/page. Explanations/history remain available on demand.
- Add/Edit team and outcome entry use bounded native dialogs. Teams default to On foot / no vehicle. Use a vehicle reveals the vehicle identifier and passenger spaces. Vehicle seats still limit dispatch; no-vehicle crews store NULL vehicle/zero seats and can assist residents without a fictitious identifier. Team, responder, resident, shelter capacity, and arrival confirmation checks remain in place. On-foot progress displays Escorting residents.
- What if initially shows scenario controls; a hypothetical result cannot dispatch real crews or record arrivals. Return to live plan navigates back to Choose residents.
- API verification passed for multiple no-vehicle teams, blank vehicle normalization, default zero seats, on-foot dispatch/escort/arrival, shared-crew conflict, arrival acknowledgement, and existing vehicle seat/capacity protection. Outcome validation/roles/history regression passed.
- Browser verification at 390×844 on isolated fictional records passed: optional vehicle field toggle; no-vehicle team setup; resident selection across pages/views; dispatch into Missions; sourced Missing → Located through the outcome dialog; crew reached residents → Escorting residents → confirmed shelter arrival. The DSS selector is 58px high; dispatch dialog is 343×812px with equal 326px client/scroll width (no horizontal overflow).
- Existing installations must rerun the latest db:migrate:rescue (or full migration) to make rescue_teams.vehicle nullable. Local migration was applied without changing actual resident or crew records.

### Navigation and workspace cohesion (October 8, 2026)

- Navigation follows Start here, Flood response, Community records, and Reporting & administration. Existing URLs and role access remain compatible.
- The persistent Find a task dialog searches available destinations and task descriptions, including rescue missions, teams, resident outcomes, registered responders, and emergency hotlines. Direct rescue tasks open the appropriate DSS view, including when DSS is already open.
- Category controls precede search. Headings and location breadcrumbs describe the selected workspace. Centers & Responders maintains resources; DSS coordinates crews and missions. Advisories & Hotlines contains public communications.
- Dashboard response tasks appear before the optional weather forecast. Data quality checks and annual resident summaries expand on demand. The center map and edit/remove records are secondary controls below occupancy cards.
- Heading hierarchy, primary/secondary buttons, selected categories, keyboard focus, and mobile touch targets share styles. DSS/statistics sections use a compact selector on small screens.
- Validation: task filtering assertions cover multiword search and exclusion of unauthorized destinations; production Angular build passes with existing bundle-size warnings. Browser checks cover direct responder/team/outcome/hotline destinations and a 390 x 844 task dialog with equal client/scroll widths. No resident or responder records are modified by these checks.

### Missing/deceased residents within rescue missions (October 8, 2026)

- Every mission resident has Record / review outcome in mission details, progress dialogs, and completed-mission history. The selected identity is prefilled; officials still provide the source, location, observed time, details, and acknowledgement. Deceased reports/corrections retain Disaster Officer/Super Admin restrictions.
- Arrival review excludes already recorded Missing/Deceased residents and shows exactly how many people will count as physically arrived. The client submits those exact identities. The server rejects unrelated identities, excluded residents without a recorded outcome, and an arriving person who is now Missing/Deceased.
- A mission with some actual arrivals can complete while its Missing/Deceased cases remain in outcome follow-up. If none arrived, report a problem then cancel instead of confirming arrival.
- Each resident's outcome at mission completion is stored in the existing mission snapshot. Later outcome corrections cannot rewrite that historical arrival count. A later Missing/Deceased report still clears the current shelter assignment and updates current occupancy.
- Verification: isolated API tests cover one arrival plus Missing and Deceased exceptions, rejection of unsourced exclusions, unrelated identities, missing-as-arrived, capacity for actual arrivals only, crew release, and later outcome reporting. Outcome role/revision tests and TypeScript checks pass. Browser inspection confirms per-resident actions open a prefilled outcome form without saving any actual data.

### Recorded outcomes in the resident editor (October 8, 2026)

Current-year resident results now include the recorded outcome, allowing the table and editor to show Missing/Deceased consistently. Historical annual snapshots are not relabeled with current outcomes. For these residents, the editor displays the recorded outcome and no shelter placement, provides a history viewer, and keeps corrections in the sourced DSS outcome workflow. Review entries also display the outcome. Registry record status is explicitly labeled separately from a person's condition. Validation: helper checks, current-year outcome API assertion, outcome integration checks, TypeScript check, and production Angular build pass with existing size warnings.


## Word document changes on 9 October 2026

- In Live Map & GIS, selecting Barangay zones or Risk zones hides other overlays. Explicit overlay toggles still work and the legend follows visible layers.
- Edit a zone name or color without drawing again. Its original Polygon or MultiPolygon, including holes, must stay unchanged.
- Add a risk zone by selecting a barangay zone from the map or dropdown. Its saved boundary and assessed risk colors are visible.
- Add an evacuation center from either GIS or Centers & Responders. The picker shows Colacling and zone boundaries. Pinning or sharing a location outside Colacling must fail. The API must reject an outside location too.
- Select a historical record year, preview and import a CSV, and check that only that year receives records. Re-importing the same resident must fail without partially writing other rows. Existing historical records remain uneditable. Use an archived household when available; otherwise the import copies the matching current household into that year's archive.
- Family dialog priorities must match the live Evacuation Planner assessment rather than the manually recorded priority.
- DSS opens the priority-area and priority-household tables, without summary cards. Assessment Filters sits beside Refresh on DSS and Reports & Statistics. Decision Rules is available through a footer reference.
- Evacuation Planner and Assistance and Shelters have separate sidebar entries. The planner retains mission dispatch, teams, simulations, and confirmed arrival workflows.
- Response Management has been removed from the application navigation and page routing at the user's request.

Run `frontend/scripts/check-dss-pages.js` in the signed-in browser console for navigation checks. With a local API running, run `node --import tsx src/document-changes.integration.test.ts` from `backend` (set PORT to the API's port). The integration check creates and removes its own fixture records.

Response action storage and backend APIs remain available; removing the page does not delete saved records. Include the backend `data` directory in deployments; the packaging script copies it automatically.
