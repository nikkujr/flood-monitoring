# Community-based flood monitoring and evacuation support system

- All maps will default to Colacling, Lupi, Camarines Sur (13.7795° N latitude and 122.8708° E longitude)
- flood monitoring
 > residents info (vulnerable)
- GIS (geographic info system)
 > low/medium/high risk zones/areas

## Tech Stack
- Frontend: Angular 22 (Typescript)
- Backend: Node.js (Express.js) - Typescript
- Database: MySQL

## Architecture
- The system will have a client-server architecture.
- Follow a simple CQRS and Vertical Slice architecture
- No automated test suite is required for the initial release; all acceptance criteria must be verified through documented manual acceptance testing.
- Create a separate backend and frontend project structure to allow for independent development and deployment.
- The frontend and backend are separate deployable projects and communicate only through the documented HTTP API.
- The backend must expose environment-based CORS configuration for the permitted frontend origin or origins.

## Application Configuration

### Authentication
- Authentication uses JSON Web Tokens (JWT).
- The frontend sends the access token in the `Authorization: Bearer <token>` header for protected API requests.
- The frontend keeps the access token in memory and must not persist it in local storage or session storage.
- The refresh token is issued in an `HttpOnly` cookie. Its `Secure`, `SameSite`, domain, and path settings must be environment-configurable for separate frontend and backend deployments.
- Access tokens expire after 15 minutes by default.
- Refresh tokens expire after 7 days by default, are stored as hashes by the backend, and are rotated whenever they are used.
- Logout revokes the current refresh token.
- JWT signing secrets, token lifetimes, and allowed frontend origins must be supplied through backend environment configuration and must not be committed to source control.
- Passwords must contain at least 12 characters, including at least one uppercase letter, one lowercase letter, and one number.

### Pagination
- Paginated list endpoints accept `page`, `pageSize`, `search`, `sortBy`, and `sortOrder` query parameters.
- `page` defaults to `1` and must be a positive integer.
- `pageSize` defaults to `20`, must be a positive integer, and cannot exceed `100`.
- `sortOrder` accepts `asc` or `desc`.
- Each endpoint must allow-list its supported `sortBy` fields and reject unsupported values.
- Paginated responses use the shape `{ items, page, pageSize, totalItems, totalPages }`.
- Default page size and maximum page size must be configurable through backend environment configuration.

### File Storage and Uploads
- Uploaded flood-report photos are stored on the backend's local filesystem.
- The upload root directory is configurable and defaults to `storage/uploads`.
- Photos are stored under `flood-reports/YYYY/MM` using generated UUID filenames; original client filenames must not be used as storage paths.
- Only JPEG (`image/jpeg`) and PNG (`image/png`) photos are accepted.
- Each photo is limited to 5 MB, and each flood report may contain at most 5 photos.
- The backend must verify file signatures in addition to MIME type and extension.
- Uploaded files are served through backend endpoints; filesystem paths must never be returned to clients.

### Map Tiles and Attribution
- Leaflet uses the OpenStreetMap standard tile layer at `https://tile.openstreetmap.org/{z}/{x}/{y}.png` with a maximum zoom level of 19.
- Every map must keep the Leaflet attribution control visible and display `© OpenStreetMap contributors` linked to `https://www.openstreetmap.org/copyright`.
- The attribution must not be obscured, removed, or placed behind a toggle.
- The tile URL must be configurable so a production tile provider can be substituted without changing application code.

## Implementation Scope

### Core Modules
- Authentication
- User Account Administration
- Dashboard
- Residents and Households
- Flood Reports
- Live Map and GIS
- Evacuation Support
- Notifications
- Report & Statistics / Decision Support

### Out of Scope for Initial Release
- Resident self-service accounts
- Native mobile application
- Offline-first synchronization
- Automated flood-sensor hardware integration
- Third-party social media broadcasting

## Roles and Permissions

### Roles
- Super Admin: Manages local authority accounts, system configuration, GIS master data, and all modules.
- Disaster Officer: Reviews reports, manages alerts, evacuation data, and decision support outputs.
- Data Encoder: Registers residents, households, shelters, and volunteers.

### Permissions Matrix
- Authentication: Super Admin, Disaster Officer, Data Encoder
- User Account Administration: Super Admin
- Residents and Households: Super Admin, Data Encoder
- Flood Report Review and Validation: Super Admin, Disaster Officer
- Notification Creation and Sending: Super Admin, Disaster Officer
- Shelter and Volunteer Management: Super Admin, Disaster Officer, Data Encoder
- Evacuation Route Management: Super Admin, Disaster Officer
- Emergency Contact Management: Super Admin, Disaster Officer, Data Encoder
- Evacuation Shelter Management: Super Admin, Disaster Officer, Data Encoder
- GIS Zone and Map Reference Data Management: Super Admin
- Dashboard and Statistics Viewing: Super Admin, Disaster Officer, Data Encoder

## Data Model

### Household
- householdId
- householdNumber
- zoneId
- addressLine
- headOfHouseholdName
- contactNumber
- memberCount
- riskLevel
- evacuationStatus
- createdAt
- updatedAt

### Resident
- residentId
- householdId
- fullName
- dateOfBirth
- sex
- contactNumber
- addressLine
- vulnerabilityType
- emergencyContactName
- emergencyContactNumber
- priorityLevel
- evacuationStatus
- createdAt
- updatedAt

### Barangay Zone
- zoneId
- zoneName
- polygonGeoJson
- description
- createdAt
- updatedAt

### Risk Zone
- riskZoneId
- riskZoneName
- riskLevel
- polygonGeoJson
- description
- createdAt
- updatedAt

### Flood Report
- reportId
- trackingCode
- reporterName (optional)
- reporterContactInfo (optional)
- locationText
- incidentType
- latitude
- longitude
- description
- photoUrls
- severityLevel
- status
- validationNotes
- validatedByUserId
- validatedAt
- createdAt
- updatedAt

### Flood Report Affected Zone
- reportId
- zoneId
- createdAt

### Evacuation Shelter
- shelterId
- shelterName
- zoneId
- locationText
- latitude
- longitude
- capacity
- currentOccupancy
- contactPerson
- contactNumber
- email
- status
- createdAt
- updatedAt

### Volunteer
- volunteerId
- fullName
- contactNumber
- email
- assignedZoneId
- availabilityStatus
- notes
- createdAt
- updatedAt

### Evacuation Route
- routeId
- routeName
- originZoneId
- destinationShelterId
- routeGeoJson
- status
- description
- createdAt
- updatedAt

### Emergency Contact
- emergencyContactId
- organizationName
- contactPerson
- phoneNumber
- email
- isPublic
- status
- createdAt
- updatedAt

### Notification
- notificationId
- floodReportId (optional)
- title
- message
- type
- severityLevel
- targetAudience
- deliveryChannel
- status
- sentByUserId
- sentAt
- createdAt
- updatedAt

### Notification Read Receipt
- notificationId
- userId
- readAt

### Notification Target Zone
- notificationId
- zoneId

### User Account
- userId
- fullName
- username
- email
- passwordHash
- role
- isActive
- lastLoginAt
- createdAt
- updatedAt

### Refresh Token
- refreshTokenId
- userId
- tokenHash
- expiresAt
- revokedAt
- replacedByTokenId
- createdAt

### Entity Relationships
- One Household has many Residents.
- One Barangay Zone has many Households, Shelters, and Volunteers.
- Risk Zones are independent flood-risk overlays and may overlap one or more Barangay Zones or other Risk Zones.
- One validated Flood Report may affect one or more Barangay Zones through Flood Report Affected Zone records.
- Notifications may be linked to validated Flood Reports and affected Zones.
- One Evacuation Route starts in a Barangay Zone and ends at an Evacuation Shelter.
- A Notification may reference one Flood Report and may target multiple Barangay Zones through Notification Target Zone records.
- Notification read/unread state is tracked only for authenticated local authority users.
- One User Account may have multiple Refresh Tokens; only unexpired and unrevoked tokens are valid.

## Statuses and Reference Values

### Flood Report Status
- Submitted
- Under Review
- Validated
- Rejected
- Resolved

### Flood Report Severity
- Information
- Minor Incident
- Major Incident

### Household / Resident Evacuation Status
- Safe
- For Monitoring
- For Evacuation
- Evacuated

### Shelter Status
- Available
- Near Capacity
- Full
- Unavailable

### Volunteer Availability Status
- Available
- Assigned
- Unavailable

## Workflow Rules

### Flood Report Intake and Validation
1. Residents submit flood reports through the public Flood Reports page with optional reporter identity and contact information.
2. New reports are stored with status `Submitted`.
3. Disaster Officer or Super Admin reviews the report, checks map location, attached photos, and duplicate reports in the same area.
4. The reviewer changes the report status to `Validated`, `Rejected`, or `Under Review`.
5. Only validated reports appear in the live public refresh feed, risk summaries, and evacuation decision support.
6. Resolved reports remain in history but are marked as closed for operational views.

### Resident and Household Management
1. A Household record must exist before a Resident can be added.
2. Resident age is derived from date of birth and must not be manually edited.
3. Vulnerability type and evacuation priority are maintained by Super Admin and Data Encoder users.
4. Duplicate checking should use full name, date of birth, and household association.
5. Household member count is calculated from associated Resident records and is not manually edited.
6. Household risk level is derived from the highest Risk Zone overlapping its assigned Barangay Zone.
7. A Household evacuation status is derived from its Residents: `Evacuated` when all members are evacuated, `For Evacuation` when any member requires evacuation, `For Monitoring` when any member requires monitoring and none requires evacuation, and `Safe` otherwise.

### Shelter Occupancy Management
1. Shelter current occupancy is maintained by authorized local authority users.
2. Current occupancy must be a whole number from zero through the shelter capacity.

### Notification Sending
1. Only Super Admin and Disaster Officer can create official notifications.
2. Notifications may target `Public`, `Affected Zones`, or `Internal Admin Users`.
3. Initial release supports in-app notifications only.
4. Notifications tied to urgent validated incidents should be marked with severity and timestamp.
5. Notifications targeting `Public` or `Affected Zones` are displayed as advisories on the public Home and Live Map pages without requiring resident accounts.
6. Read/unread state applies only to authenticated local authority users; public advisories do not track individual reads.

### Password Recovery
1. Local authority accounts use their registered email address for password recovery.
2. Forgot-password requests must not reveal whether an account exists.
3. A time-limited, single-use reset token is sent to the registered email address.

### User Account Administration
1. Only Super Admin users can create, view, update, activate, deactivate, or reset the password of another local authority account.
2. Usernames and email addresses must be unique.
3. A Super Admin selects one of the defined roles when creating or updating an account.
4. Accounts are deactivated instead of deleted so audit references remain intact.
5. Deactivating an account revokes all of its active refresh tokens.
6. A Super Admin cannot deactivate their own account.
7. The system must prevent deactivation of the last active Super Admin account.

### GIS and Map Management
1. All maps default to Colacling, Lupi, Camarines Sur.
2. Zone boundaries are maintained as GeoJSON polygon data by Super Admin users.
3. Evacuation shelters and validated flood reports are stored as map points with latitude and longitude.
4. Public live map refreshes every 30 seconds by polling the backend for validated incident and map overlay data.

### Decision Support Calculation
1. Only unresolved validated Flood Reports contribute to the current overall risk level.
2. Overall risk is `High` when any contributing report is a Major Incident or affects a High-risk zone.
3. Otherwise, overall risk is `Medium` when any contributing report is a Minor Incident or affects a Medium-risk zone.
4. Overall risk is `Low` when no contributing report meets the Medium or High conditions.

## API Scope

### Authentication
- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `POST /api/auth/forgot-password`
- `POST /api/auth/reset-password`
- `POST /api/auth/logout`
- `GET /api/auth/me`

### User Account Administration
- `GET /api/users`
- `POST /api/users`
- `GET /api/users/:userId`
- `PUT /api/users/:userId`
- `PUT /api/users/:userId/active-status`
- `POST /api/users/:userId/reset-password`

### Dashboard
- `GET /api/dashboard/summary`
- `GET /api/dashboard/recent-reports`
- `GET /api/dashboard/notifications`

### Households
- `GET /api/households`
- `POST /api/households`
- `GET /api/households/:householdId`
- `PUT /api/households/:householdId`

### Residents
- `GET /api/residents`
- `POST /api/residents`
- `GET /api/residents/:residentId`
- `PUT /api/residents/:residentId`

### Flood Reports
- `GET /api/flood-reports/public`
- `POST /api/flood-reports`
- `GET /api/flood-reports`
- `GET /api/flood-reports/:reportId`
- `PUT /api/flood-reports/:reportId/status`

### GIS and Live Map
- `GET /api/map/live`
- `GET /api/barangay-zones`
- `POST /api/barangay-zones`
- `PUT /api/barangay-zones/:zoneId`
- `DELETE /api/barangay-zones/:zoneId`
- `GET /api/risk-zones`
- `POST /api/risk-zones`
- `PUT /api/risk-zones/:riskZoneId`
- `DELETE /api/risk-zones/:riskZoneId`

### Evacuation Support
- `GET /api/shelters`
- `POST /api/shelters`
- `PUT /api/shelters/:shelterId`
- `GET /api/volunteers`
- `POST /api/volunteers`
- `PUT /api/volunteers/:volunteerId`
- `GET /api/evacuation-routes`
- `POST /api/evacuation-routes`
- `PUT /api/evacuation-routes/:routeId`
- `GET /api/emergency-contacts`
- `POST /api/emergency-contacts`
- `PUT /api/emergency-contacts/:emergencyContactId`

### Notifications
- `GET /api/notifications`
- `POST /api/notifications`
- `PUT /api/notifications/:notificationId`
- `POST /api/notifications/:notificationId/send`
- `POST /api/notifications/:notificationId/archive`
- `PUT /api/notifications/:notificationId/read-status`

### Report & Statistics / Decision Support
- `GET /api/statistics/risk-summary`
- `GET /api/statistics/zone-breakdown`
- `GET /api/statistics/evacuation-priorities`

## Operational Seed Data
- The backend must provide an idempotent seed command that can be run repeatedly without creating duplicates.
- Seed records must use deterministic identifiers or unique keys and must be clearly identifiable as generated demonstration data.
- The seed must generate:
  - 3 local authority accounts: one Super Admin, one Disaster Officer, and one Data Encoder.
  - 5 Barangay Zones with valid non-overlapping administrative-boundary GeoJSON polygons around the default Colacling map center.
  - 5 Risk Zones with Low, Medium, and High classifications; Risk Zone polygons may cross or overlap Barangay Zone boundaries.
  - 25 Households distributed across the seeded zones.
  - 75 Residents distributed across the seeded households, including representative elderly, child, pregnant, disabled, and mobility-limited vulnerability records.
  - 3 Evacuation Shelters with different capacities and occupancy levels.
  - 12 Volunteers with a mixture of availability statuses.
  - 3 Evacuation Routes connecting seeded zones to seeded shelters.
  - 5 public Emergency Contacts.
  - 6 Flood Reports covering Submitted, Under Review, Validated, Rejected, and Resolved statuses and all severity levels.
  - 4 Notifications covering public, affected-zone, and internal audiences.
- Seeded names, phone numbers, email addresses, reports, and resident details must be fictional and must not represent real individuals.
- The initial seed-account password is read from the `SEED_DEFAULT_PASSWORD` environment variable, is salted and hashed before storage, and must never be included in source control or logs.
- Seed data is intended for development and demonstration environments and must not run automatically in production.

## Users

- Residents
- Local authorities

## Terms

- Vulnerable Residents: Individuals who are at a higher risk during flood events due to factors such as age, health conditions, or mobility limitations. This includes elderly residents, pregnant women, children, and individuals with disabilities.
- Barangay Zone: An administrative and planning area whose boundary is maintained by the local authority.
- Risk Zone: An independently drawn flood-risk overlay classified as Low, Medium, or High. It may occur anywhere in the barangay and overlap Barangay Zones or other Risk Zones.

## Access Model

### Public Pages (No Authentication Required)
- Home Page
- Flood Reports Page (residents can submit reports anonymously or with contact info only)
- Live Map Page

### Admin Pages (Local Authorities Only - Authentication Required)
- User Account Administration Page (Super Admin only)
- Residents Management Page
- Households Management Page
- Flood Report Review Page
- Live Map and GIS Management Page
- Evacuation Support Page
- Notification Page
- Dashboard
- Report & Statistics (Decision Support)

### User Accounts
- Only Local Authorities have login accounts
- Residents do NOT have accounts; they interact only through public, unauthenticated pages
- Resident data is registered and managed only by Super Admin and Data Encoder users

## Theme 
 - Professional government-style UI using Poppins font, Lucide Angular icons, a white content area (#F5F7FA), rounded cards (12px), soft shadows, responsive tables, and interactive Leaflet maps.
 Note: Public pages use a top navigation layout. Admin pages use a fixed left sidebar with a vertical gradient background (#00276C → #0043BC) plus a sticky top navigation bar.

Admin Sidebar Menu:
- Home
- Admin Dashboard
- User Accounts (Super Admin only)
- Live Map and GIS
- Flood Report Review
- Residents
- Households
- Evacuation Support
- Report & Statistics
- Notifications
- Logout

- Admin top navigation bar ( current date and time, notification bell, and logged-in user profile )
- Public top navigation bar ( Barangay Colacling logo, BantayBaha system name, and links to Home, Live Map, and Flood Reports )

Color Palette Theme:
- Sidebar Gradient: #00276C → #0043BC
- Background: #F5F7FA
- Cards: White

## Pages
- Login Page
    - Navigation Bar
        UI:
            - Displays the Barangay Colacling logo and the BantayBaha system name
            - Public navigation links to Home, Live Map, and Flood Reports
    - Welcome Section
        UI:
            - Displays a welcome message, the BantayBaha system title, a short system description, a flood monitoring map illustration, and Get Started and Learn More buttons.
            - States that login access is for authorized local authorities only.
    - LogIn Field
        UI:
            - Displays a centered login card with username and password fields
            - A show/hide password button
            - A Login button
            - A link for Forgot Password.
    - Validation
        UI:
            - Ensure the username and password fields are completed
            - Display an error message if the username or password is incorrect.
            - Show inline validation messages for empty or invalid fields.
    - User Experience (UX)
        UI:
            - Automatically focuses on the username field, allows users to press Enter to log in, displays a loading indicator during authentication, and redirects users to their dashboard after a successful login.
    - Footer
        UI:
            - Displays the copyright notice: © 2026 Barangay Colacling | All Rights Reserved.

- Admin Dashboard
    - Layout:
        - The dashboard uses a clean, single-page layout with a fixed sidebar for navigation and a header displaying the date, time, notifications, and user profile. The main content area displays summary cards for total residents, households, vulnerable residents, and flood reports. Below the summary cards, there are sections for recent flood reports, evacuation support requests, and system notifications. This layout allows administrators to quickly access important information and manage the system efficiently.

- User Account Administration Page (Admin - Super Admin Only)
    - Shows local authority accounts
        UI:
            - Paginated table with full name, username, email, role, active status, last login, and available actions
            - Search and filters by role and active status
            - Actions for viewing, creating, editing, activating, deactivating, and initiating password reset
    - User account form
        UI:
            - Input fields for full name, username, email, role, active status, and initial password when creating an account
        Validation:
            - Full name, username, email, and role are required.
            - Username and email must be unique.
            - Email must use a valid format.
            - Password must satisfy the configured password policy.
            - A user cannot deactivate their own account.
            - The last active Super Admin account cannot be deactivated.

- Home Page (Public)
    - Layout:
        - The page uses a clean, single-page layout. The flood risk overview is displayed at the top, followed by evacuation shelters, emergency contacts, quick links, the map legend, and alert notifications. This arrangement allows users to quickly access important flood information and emergency resources.

    - Overview of flood risk zones (Map view)
        UI:
            - Clickable Live View Map Preview ( When you clicked the overview map, it will go to the full-page version of the live map page )
            - card view of summary overview that consists of total reports, high risk areas, affected zones
    - List of nearby evacuation shelters
    - List of emergency contacts and shelters
    - Quick links to report incidents and view evacuation shelters
    - Map legend
        UI:
            - Displays icons and color indicators to identify map information:
                - Low Risk Area: Safe areas with minimal flood risk
                - Medium Risk Area: Areas requiring monitoring
                - High Risk Area: Flood-prone areas requiring attention
                - Evacuation Shelters: Shows shelter locations and availability
                - Evacuation Shelters: Displays available evacuation centers
                - Flood Incident Reports: Indicates reported flood locations based on severity level
    - Alert Notification and Advisory 
        UI:
            - Displays flood alerts and advisories using color indicators based on incident severity
                - Yellow for monitoring updates
                - Orange for preparation
                - Red for emergency evacuation


- Residents Management Page (Admin)
    - Note: A resident belongs to a household
    - Layout: 
            - Uses a dashboard layout with a fixed sidebar for navigation and a header displaying the date, time, notifications, and user profile.
            - The page title and "Add Resident" button are positioned at the top for easy access.
            - Summary cards (Total Residents, Households, and Vulnerable Residents) are displayed below the header to provide a quick overview.
            - A search bar, filter options, and sorting controls are placed above the resident table for efficient data retrieval.
            - The main content area displays a responsive table of resident records with action buttons for viewing and editing information
            - The layout follows a top-to-bottom flow, allowing administrators to quickly access statistics, search records, and manage resident information.

    -Shows the list of residents information
        UI:
            - Table of residents with details (full name, contact number, zone address, vulnerability, household number)
            - filter (by household (textfield), by vulnerability (dropdown), by zone (textfield)) and sort options
            - search menu
            - clickable card view of households consists of total households, number of members, vulnerability status, risk level, evacuation status
            - clickable vulnerable residents card view consists of list of vulnerable residents
            - card view of total residents
    - Add Resident button that opens a resident registration form
        UI: 
            - Input fields for resident information (full name, date of birth, age [auto-calculated], contact number, home address, vulnerability, emergency contact, household number)
        Validation:
            - All required fields must be completed before saving.
            - Contact numbers must contain valid digits only.
            - Date of birth cannot be a future date.
            - Age is automatically calculated from the date of birth. 
            - Household ID must exist before assigning a resident.
            - Duplicate resident records are not allowed.
            - A success message is displayed after the resident is successfully added.
            - An error message is displayed if validation fails or required information is missing.

- Households Management Page (Admin)
    - Shows household records and their associated residents
        UI:
            - Responsive table with household number, address, zone, calculated member count, inherited risk level, and derived evacuation status
            - Search, zone filter, risk filter, and evacuation status filter
            - Actions for viewing, creating, and editing household records
    - Household registration and edit form
        UI:
            - Input fields for household number, zone, address, head of household, contact number, and verification status
            - Household verification status can be updated to `Pending Verification`, `Verified`, or `Rejected`.
        Validation:
            - Household number must be unique.
            - The selected Barangay Zone must exist.
            - Member count, risk level, and evacuation status are calculated and cannot be manually edited.

- Evacuation Support Page (Admin)
    - Shelters, volunteers, and emergency contacts support create, view, update, and delete operations subject to role permissions and database dependencies.
    - Evacuation routes do not have a dedicated page or tab in Evacuation Support.
    - The shelter tab displays an operational map; selecting a table record focuses its marker.
    - A shelter cannot be deleted while an evacuation route references it.
    - Evacuation routes and shelters
        UI:
            - Interactive map showing evacuation routes and shelter locations
            - Clickable markers for shelters with details (capacity, contact info)
    - Volunteer Management
        UI:
            - Admin-managed registration form for volunteers (name, contact info, availability)
            - List of registered volunteers and their availability status
        Validation:
            - Ensure all required fields are filled
            - Validate contact info format (email, phone number)
    - Register an evacuation shelter
        UI:
            - Registration form for shelters (name, location, capacity, contact info)
        Validation:
            - Ensure all required fields are filled
            - Validate contact info format (location, email, phone number)
    - Emergency contact information
        UI:
            - List of emergency contacts with phone numbers and email addresses


- Flood Reports Page (Public)
    - Submission form for residents to report flood incidents
        UI:
            - Input fields for incident details (location, description, photos, reporter's name, reporter's contact info)
            - Incident type is required and selected from River Flooding, Flash Flood, Road Flooding, Drainage Overflow, Rising Water, or Other.
            - Incident level is required and selected from Information, Minor Incident, or Major Incident.
            - Incident coordinates are selected by pinning the location in a Leaflet map picker; public users do not manually enter latitude or longitude.
    - List of validated reported incidents
        UI:
            - Table or card view of incidents with details (location, description, status)
            - Validated incident cards display all submitted photos when present.
            - Filter and sort options
    - Map view showing incident locations
        UI:
            - Interactive map with markers for each reported incident
            - Clickable markers to view incident details
- Live Map Page (Public)
    - Detailed Map Live View
    - Overview of flood risk zones (Map view of Barangay Colacling, Lupi, Camarines Sur) 
        UI:
            - Interactive map with color-coded flood risk zones (Low, Medium, High)
            - Public layer filters allow Barangay Zones, Evacuation Shelters, and Risk Zones to be independently shown or hidden.
            - A collapsible sidebar beside the map lists Barangay Zones, Evacuation Shelters, Risk Zones, validated Incident Reports, and active announcements.
            - Only one sidebar table is expanded at a time so all section headers remain visible without scrolling the full-page live view.
            - Selecting a zone or shelter record focuses and highlights its polygon or marker. Selecting an announcement linked to a validated report focuses that report location.
            - Selecting an Incident Report focuses its marker. Clicking an incident marker opens a modal displaying the report location, severity, description, timestamp, and large submitted photo previews.
            - Map tables refresh with the same 30-second live-map data cycle.
            - Active public announcements appear in a television-style scrolling ticker directly below the map. The ticker pauses on hover and does not animate when the user prefers reduced motion.
            - Displays flood reports using incident severity indicators:
                - Yellow (Information): Shows flood updates and general reports for monitoring
                - Orange (Minor Incident): Highlights areas requiring attention and response preparation
                - Red (Major Incident): Identifies critical areas requiring immediate action and emergency response
            - Clickable zones to view detailed flood information
            - Map indicators for flood incidents and evacuation shelters
            - Barangay Zone, Risk Zone, and Evacuation Shelter table rows are clickable; selecting a row pans or zooms the map to the corresponding polygon or marker and highlights it.
            - Updates based on validated flood reports every 30 seconds

- Live Map and GIS Management Page (Admin)
    - Uses the live map with administrative controls based on role permissions
        UI:
            - Super Admin users can create, update, and delete Barangay Zone boundaries, names, and descriptions.
            - Super Admin users can independently create, update, and delete Risk Zone boundaries, names, descriptions, and risk levels.
            - Polygon boundaries are entered through an interactive map editor by placing, undoing, and clearing boundary points; users are not required to write GeoJSON.
            - A Barangay Zone cannot be deleted while households, shelters, volunteers, evacuation routes, flood reports, or notifications reference it.
            - Super Admin, Disaster Officer, and Data Encoder users can create and update evacuation shelter locations, capacities, occupancy, contacts, and availability statuses.
            - Shelter latitude and longitude are selected by pinning the location in a Leaflet map editor; users are not required to enter coordinates manually.
            - Create, update, delete, activation, notification, and read-status operations display dismissible success or error feedback.
            - Editor dialogs close through the close button, Cancel button, backdrop, or a successful operation and must clear stale dialog state.
            - Forms validate GeoJSON polygons, latitude and longitude, required fields, and reading timestamps.

- Flood Report Review Page (Admin)
    - Review queue for submitted and under-review flood reports
        UI:
            - Table or card view with tracking code, location, description, photos, reporter contact information when supplied, severity, status, and submission time
            - Incident type is shown in the report table and review dialog.
            - The reviewing administrator can override the submitted incident level with Information, Minor Incident, or Major Incident before saving a status update.
            - Submitted photos are displayed as authenticated previews in the report review dialog and can be opened at full size.
            - Search and filters by status, severity, location, and date
            - Map preview and duplicate-report indicators for the same area
            - Actions to mark a report as `Under Review`, `Validated`, `Rejected`, or `Resolved`
            - The Flood Reports sidebar badge displays the live total of Submitted and Under Review reports.
            - Every report status update requires at least one existing affected Barangay Zone selected from a multi-select control.
        Validation:
            - Only Super Admin and Disaster Officer users can change report status.
            - Validation or rejection requires reviewer notes.
            - Validated reports must identify at least one affected Barangay Zone.


- Notification Page (Admin)
    - Shows the list of flood alerts, advisories, and system notifications for residents and barangay officials.
        UI: 
            - Notification list with details (title, message, date and time, severity level, status)
            - Color-coded alert indicators based on incident severity:
                - Yellow: Monitoring updates and general information
                - Orange: Preparation and precautionary actions
                - Red: Emergency evacuation and urgent response
            - Notification cards showing flood incident details and recommended actions
            - Filter options by notification type and severity level
            - Search menu for specific notifications
            - Mark as read/unread option for authenticated local authority users
            - Notification history archive
    - Create, view, update, send, and archive notifications
        Validation:
            - Notification message is required before sending
            - Alert severity level must be selected
            - Date and time are automatically recorded
            - Only authorized users can create and send official advisories
            - Confirmation message displayed after successful notification delivery


- Report & Statistics / Decision Support (Admin)
    - Provides flood risk assessment and evacuation priorities using flood reports and resident data
        UI:
            - Overall Risk Level showing current flood status (Low, Medium, High)
                - Displays affected areas, risk assessment, and priority evacuees
                - Updates based on validated flood reports
            - Zone Risk Breakdown showing risk levels per barangay zone
                - Displays zone, risk level, active reports, and affected residents
            - Evacuation Priorities showing residents needing assistance
                - Displays name, location, priority level, and vulnerability status
            - Risk Summary Dashboard with flood status cards, charts, and indicators
            - Filter and search options for zones, residents, and reports

## Acceptance Criteria

### Authentication
- Authorized local authority users can log in with valid credentials.
- Unauthorized users cannot access admin pages without authentication.
- Residents can use all public pages without creating an account.
- Protected APIs reject missing, invalid, expired, or revoked authentication credentials.
- A valid refresh token can obtain a new access token and is rotated after use.
- Logout revokes the current refresh token.

### User Account Administration
- Only Super Admin users can access user-account administration APIs and pages.
- A Super Admin can create, view, update, activate, deactivate, and initiate password reset for local authority accounts.
- Duplicate usernames and email addresses are rejected.
- The current user and the last active Super Admin cannot be deactivated.

### Residents and Households
- Super Admin and Data Encoder users can create, view, search, filter, and update households and residents.
- A resident cannot be saved without an existing household.
- Resident age is auto-calculated from date of birth.

### Flood Reports
- Residents can submit a flood report with location, description, and optional contact information.
- Each submitted photo is JPEG or PNG, does not exceed 5 MB, and no more than 5 photos are attached to one report.
- Submitted reports appear in the admin review queue.
- Only validated reports appear on the public live map and in decision support summaries.

### Live Map and GIS
- The live map loads centered on Colacling, Lupi, Camarines Sur.
- The map displays Barangay Zones, Risk Zones, evacuation shelters, and validated incidents with correct legends.
- The public map refreshes incident data every 30 seconds.

### Notifications
- Super Admin and Disaster Officer users can create and send in-app notifications.
- Notifications show title, message, severity, timestamp, and status.
- Users can filter notification history by type and severity.

### Decision Support
- The system computes and displays overall risk level from validated flood reports and zone data.
- The system shows evacuation priority views using resident vulnerability and affected zone data.

### Pagination
- Paginated endpoints default to page 1 with 20 records and reject page sizes greater than 100.
- Paginated responses include items, current page, page size, total item count, and total page count.

### Operational Seed Data
- The seed command creates the defined fictional operational dataset.
- Running the seed command more than once does not create duplicate records.
- Seeded passwords are read from environment configuration and stored only as salted hashes.

## Non-Functional Requirements
- Audit timestamps must be stored for all admin-created or admin-updated records.
- Public pages should remain usable on mobile and desktop devices.
- Admin pages should load list views with pagination for large datasets.
- Uploaded report photos must be validated by file type and size.
- Local upload directories must not permit executable files or direct path traversal, and upload filenames must be generated by the backend.
- Passwords must be stored securely using salted hashing.
