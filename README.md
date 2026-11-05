# Trackify: the project & task desk

A project and task management system built for the IVTEX Technical Team Lead assignment. React (Vite, Redux Toolkit, axios) · Node.js / Express · PostgreSQL · JWT + role-based access.

Trackify is not a generic Kanban clone. Three ideas set it apart:

1. **Pace, not just percent.** Every project shows actual progress against where it *should* be today, a Steady / Drifting / Slipping health stamp, and a straight-line finish forecast ("lands 12 Dec, 34 days late").
2. **A review gate.** Developers can only submit work for review. A lead approves (or sends it back with a note). Nothing is Completed on its own say-so.
3. **A ledger.** Every status change, progress report, blocker, assignment and note is written once to a task timeline. The dashboard opens with a plain-English brief generated from that data.

## Quick start

Requirements: Node 20+, PostgreSQL 13+ (or Docker).

```bash
# 1. database (skip if you already have Postgres)
docker compose up -d db          # creates user/db "foreman"

# 2. install + configure
npm run setup
cp server/.env.example server/.env   # adjust DATABASE_URL if needed

# 3. create tables and demo data (relative dates, so the demo always looks live)
npm run seed

# 4. run (two terminals)
npm run dev:api                  # http://localhost:4000
npm run dev:web                  # http://localhost:5173
```

Single-process mode (API serves the built UI): `npm run build && npm start`, then open http://localhost:4000.
Everything in Docker: `docker compose up --build`, then `docker compose exec app node server/src/seed.js --force`.

### Sample logins (password for all: `Foreman@123`)

| Role | Email |
|---|---|
| Team lead | `lead@foreman.dev` |
| Developer | `asha@foreman.dev`, `ravi@foreman.dev`, `meera@foreman.dev`, `kabir@foreman.dev` |

The login page has one-click demo buttons.

### What the demo data shows
Payments Gateway Migration is **Slipping** (overdue tasks, a blocker, a 34-day forecast slip). Storefront Revamp is **Drifting**. Mobile Companion App is **Steady**. Vendor Onboarding is **Done**. Analytics Warehouse is **Queued**. Ravi is overloaded and Asha has spare capacity. SFR-3 is waiting in the review queue.

## Try this (3 minutes)
1. Sign in as **Asha**, open *My work*, open SFR-3 (already in review). Notice you cannot approve it.
2. Sign in as **Priya (lead)**, open the review queue on the Desk, click **Send back**: it demands a note. Then approve another task and watch the project's progress and health move.
3. As Ravi, open PAY-3 and flag a blocker. Back as the lead, the brief now mentions it.

## Tests
```bash
npm test      # 20 tests: pure rules/metrics + API integration (needs the foreman_test database)
```
Create the test DB once: `createdb foreman_test` (same user and password as `DATABASE_URL`, or set `TEST_DATABASE_URL`). Tests reseed that database and never touch your dev data.

## Project layout
```
server/  src/routes (auth, users, projects, tasks, dashboard)
         src/lib    (rules.js status graph · metrics.js progress/health/forecast · data.js queries · errors.js)
         db/schema.sql · src/seed.js · test/
client/  src/store (http.js axios · apiSlice.js RTK Query · authSlice · toastSlice) · src/pages · ui.jsx · forms.jsx
docs/    SRS.md · EXECUTION_PLAN.md · API.md · schema.sql · Foreman.postman_collection.json
```

## Configuration (`server/.env`)
`DATABASE_URL`, `DATABASE_SSL`, `JWT_SECRET` (required in production), `JWT_EXPIRES`, `CORS_ORIGIN`, `APP_TZ` (default Asia/Kolkata; decides what "overdue" means), `PORT`.

## Deployment
`render.yaml` is a Render blueprint (web service from the Dockerfile plus a free Postgres). Connect the repository and deploy, then seed once from your machine against the database's external URL: `cd server && DATABASE_URL=<external url> DATABASE_SSL=true npm run seed -- --force`. Any container host works the same way. Step-by-step guide and a frontend-to-backend code walkthrough: [docs/CODE_FLOW_AND_DEPLOYMENT.md](docs/CODE_FLOW_AND_DEPLOYMENT.md).

**Deployed demo link:** _add after deploying: https://…_

## Documents
- [SRS](docs/SRS.md): scope, roles and permissions, business rules, data model, NFRs, assumptions, acceptance criteria
- [Technical execution plan](docs/EXECUTION_PLAN.md): architecture, team allocation, 3-week sprint plan, review and release process, risks
- [API reference](docs/API.md) and [Postman collection](docs/Foreman.postman_collection.json)
- [Database schema](docs/schema.sql) (sample data comes from `npm run seed`)

## Known limitations
- Not yet deployed from this repository: the demo link above must be filled in after you deploy.
- The JWT is kept in `localStorage` (simple for an SPA, exposed to XSS). Hardening path: httpOnly cookie + CSRF token.
- No password-reset email, refresh tokens, notifications, attachments or drag-and-drop between board columns (status changes use buttons so the review rules stay enforceable).
- Task lists load up to 200 items per view; there is no paging UI yet.
- Automated tests cover the API and rules; the UI has been checked manually in a headless browser but has no component or end-to-end tests yet.
