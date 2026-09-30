# Reports & Statistics decision support

The authenticated `GET /api/statistics/dss` endpoint reads the existing MySQL database in a consistent, read-only snapshot. It does not generate operational records, alter saved priorities, or change evacuation statuses. The Statistics page refreshes every 30 seconds and on filter changes.

## Rules

Zone risk is evaluated in this order:

1. **Critical:** five or more active validated reports in one zone; or at least one active major incident, at least two active validated reports, and at least one registered vulnerable resident.
2. **High:** three to four active validated reports, at least one active major incident, or at least two active minor incidents.
3. **Moderate:** one to two active validated reports unless a severity/vulnerability rule raises the risk.
4. **Low:** no active validated reports within the selected incident scope. Low does not establish safety.

At three active validated reports, the system displays a zone alert. At five, the alert and zone assessment escalate to Critical. The live GIS map uses the same active-report thresholds and colors assessed zones green (Low), amber (Moderate), orange-red (High), or dark red (Critical).

These are application decision-support rules, not an externally validated flood prediction model. The page displays the rules and contributing counts. Unassigned active reports are flagged because no reliable zone assessment is possible for them. Submitted and Under Review reports are counted separately and recommended for validation. Resolved and Rejected reports do not raise current risk. Repeated reports are at least two Validated/Resolved records in the selected period; they are not asserted to be separate flood events.

Vulnerability is recognized from date of birth (60+ or under 18, as of the current Manila date), explicit vulnerability, PWD details, or morbidity. Negative placeholders such as N, No, None and N/A do not count. Categories are deduplicated per resident. Medical text is shown as recorded without interpreting diagnoses. Swimming ability and light-material housing appear as assistance context when recorded.

Vulnerable residents receive Highest / High / Medium / Lower priority at Critical / High / Moderate / Low zone risk. Other residents receive High at Critical, Medium at High, and Lower otherwise. A saved High priority raises active-zone priority to at least High. The evacuation queue excludes Lower priorities and residents recorded as Evacuated. Household urgency is the most urgent outstanding member's priority. All priority lists sort urgent cases first.

Potentially affected populations are the registered residents and households in zones with active validated reports; these counts are not confirmed affected individuals. Missing population data is indicated. A report linked to several zones is counted once overall, and once per associated zone. Multiple reports cannot multiply resident counts.

Shelter available capacity is capacity minus occupancy, bounded at zero. Full and Unavailable centers contribute zero spaces; unknown occupancy is not treated as zero occupancy. Nearly Full means at least 90% occupancy or an existing Near Capacity status. Per-zone capacity considerations compare outstanding selected priority residents against known operational spaces; this is a planning estimate, not an evacuation assignment.

## Filters

Query parameters: `zone` (UUID), `risk`, `from`, `to` (YYYY-MM-DD), `severity`, `evacuationStatus`, `vulnerability`.

- Date/severity filters select report records, including reports used to calculate risk. Dates are inclusive and refer to report creation dates. These are scoped assessments, not historical status reconstructions.
- Zone and assessed-risk filters narrow the assessment's zones and associated reports, population, recommendations and shelters.
- Resident vulnerability and evacuation-status filters narrow population counts and priority/capacity demand. They do not change physical shelter capacity or hide underlying zone risk, which uses the complete registered zone population.
- Unassigned reports are included only when no zone/risk filter is selected.
- Empty selections, absent data and API errors have explicit states. Failed refreshes remove the previous result so it cannot be mistaken for a fresh assessment.

## Implementation and checks

- `src/dss.ts`: deterministic rules and aggregation.
- `src/dss-api.ts`: validated query parameters and database snapshot.
- `src/server.ts`: authenticated endpoint registration; existing endpoints remain available.
- `frontend/src/app/dss.component.*` and `dss.models.ts`: dedicated responsive Statistics page, filters, lists, status and recommendations.
- `frontend/src/app/api.service.ts`, `app.ts`, `app.html`: REST client and page integration.
- `tests/dss.test.mjs`: rule boundaries, empty data, deduplication, age boundaries, filters, capacity and query validation.

Run `npm.cmd run build` and `node --test tests/dss.test.mjs` from the backend. Run `npm.cmd run build -- --configuration development` from the frontend. Test fixtures are in-memory only and are never inserted into the operational database.

Verified during implementation: all 12 rule tests; backend and frontend development compilation; live database totals and zone filters; authenticated REST access and invalid-query rejection; browser rendering, filters, empty results, failure/retry, and mobile overflow. The production build currently fails on the pre-existing `app.scss` component budget (30.89 kB against a 30 kB limit). DSS styles are isolated in `dss.component.scss`.
