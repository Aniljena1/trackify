# Technical Execution Plan

Scenario: four developers, three weeks, to deliver Foreman. I lead and review, and take the riskiest slice myself.

## 1. System architecture

```
React 18 SPA (Vite)  ──HTTPS/JSON──▶  Express API  ──pg──▶  PostgreSQL
 pages · drawer · forms                routes → lib (rules, metrics)     users · projects · members
 state: Redux Toolkit + RTK Query (axios)  middleware: auth, validate, errors  tasks · task_updates
```
- **Frontend:** route-level pages, one shared UI kit, Redux Toolkit store (auth, toasts) with RTK Query over axios; tag invalidation refreshes every visible view after any write. The task drawer is URL-addressable (`?task=id`).
- **Backend:** thin route files; business rules (`rules.js`) and numbers (`metrics.js`) are pure functions with unit tests. Validation with zod at the edge, a single error handler.
- **API style:** REST, resource-oriented, role-scoped responses. Actions that are not plain CRUD are explicit sub-resources (`/tasks/:id/transition`, `/progress`, `/block`).
- **Database:** PostgreSQL, constraints in the schema, an append-only `task_updates` ledger.
- **Contract first:** the OpenAPI-style table in `API.md` and the Postman collection are agreed on day 1 so frontend and backend work in parallel.

## 2. Team allocation

| Dev | Owns | Also |
|---|---|---|
| **Dev A: Backend core** | Schema, auth/JWT/RBAC, users and projects APIs, seed data | Pairs with D on test fixtures |
| **Dev B: Backend domain** | Tasks API, status rules, progress/health/forecast maths, dashboard endpoint | Writes the unit tests for the rules |
| **Dev C: Frontend platform** | App shell, routing, auth flow, API client, UI kit, login, projects pages | Accessibility and responsive pass |
| **Dev D: Frontend features** | Dashboard, task board/list, task drawer and forms, filters | Postman collection, docs, demo script |
| **Lead (me)** | Architecture, API contract, review of every PR, CI and deploy pipeline, the status-rules and health-score design | Unblocks, runs demos, risk log, management report |

No one is a single point of failure: each area has a named backup (A↔B, C↔D) and each PR is reviewed by one peer plus me.

## 3. Sprint plan (3 weeks, 3 demo Fridays)

| Week | Goal | Milestone (demoable) |
|---|---|---|
| **1. Foundations** | Repo, CI, schema, auth + RBAC, project CRUD, app shell, login, project list. API contract frozen Day 2. | Friday demo: sign in as lead and developer, create a project, see role-based navigation |
| **2. Core workflow** | Tasks CRUD, assignment, status rules and the review gate, progress and blockers, ledger, board and list views, filters, drawer | Friday demo: a task goes To Do → Under Review → Completed through both roles |
| **3. Insight and hardening** | Dashboard, health score, forecast, workload, validation polish, responsive pass, security review, test gaps, docs, deploy, buffer | Friday: production deploy, full walkthrough against the acceptance criteria |

Rules of the sprint: scope freeze at the end of Week 2 Wednesday; Week 3 Thursday-Friday is buffer only. Anything that slips is cut from "nice to have" (filters beyond the required ones, workload strip) never from the core flow.

## 4. Task monitoring and handling delays

- Work lives on a board with the same four statuses as the product (we eat our own cooking). Every ticket has an owner, an estimate in points and a deadline.
- **Daily 15-minute stand-up** (async note if someone is blocked in meetings): yesterday, today, blockers. Blockers get an owner and a time-box before the call ends.
- **Early-warning rules:** a ticket with no movement for 24 h gets a ping; a ticket at 80 % of its estimate without a PR gets a pairing session; two slipped tickets in a sprint trigger a re-plan on the next morning, not at the demo.
- **Handling delay:** (1) find the cause: unclear spec, technical surprise or availability; (2) swap or pair before extending; (3) cut scope with the product owner in writing; (4) only then move dates, with a risk note in the weekly report.
- **Burn-up chart** by points, updated daily; forecast the finish the same way Foreman does.

## 5. Code review and repository workflow

- **Branching:** trunk-based with short-lived branches: `main` (always deployable) ← `feat/<ticket>-slug`, `fix/…`, `chore/…`. Merge by squash. Release by tag (`v1.0.0`).
- **Pull requests:** at most about 400 changed lines; template with *what, why, how tested, screenshots*. One reviewer plus me for anything touching auth, rules or the schema. Target review turnaround: 4 working hours.
- **Review checklist:** permissions checked on the server, input validated, SQL parameterised, errors consistent, a test for each new rule, no secrets, accessible markup, no dead code.
- **Standards:** ESLint + Prettier on commit (husky), conventional commit messages, ES modules, no business logic in route handlers or components.
- **Protected `main`:** required checks (lint, tests, build) and one approval.

## 6. Testing and deployment

| Layer | Approach |
|---|---|
| Unit | Pure rules and metrics: status graph, progress, health, forecast, workload (fast, run on every save) |
| API integration | supertest against a real PostgreSQL test database: auth, RBAC, lifecycle, validation, filters, dashboard |
| UI | Component tests for forms and drawer in Week 3, plus a Playwright smoke path (login → create task → submit → approve) |
| Manual | Acceptance criteria checklist on staging, two browsers, one phone |
| Non-functional | `npm audit`, a 50-user load smoke test on the dashboard endpoint, Lighthouse accessibility check |

**Pipeline:** PR → CI (lint, test, build) → merge to `main` → auto-deploy to **staging** → tag → manual approval → **production**. One Docker image serves the API and the built UI. Migrations are idempotent SQL applied at boot. Release prep: changelog, seed data check, backup of the production database, smoke test script, rollback = redeploy previous image (schema changes are additive).

## 7. Risk management

| Risk | Likelihood / impact | Mitigation | Contingency |
|---|---|---|---|
| Frontend and backend drift | Medium / High | Contract frozen on day 2, Postman collection as the shared test, mock server for the UI until APIs land | Integration day at the end of Week 1 |
| Status rules misunderstood | Medium / High | Rules written once as a table (SRS 4.1) and as unit tests before the UI uses them | Lead owns changes to the rules |
| Auth or permission bug | Low / Critical | Server-side checks only, RBAC tests per route, security review in Week 3 | Hotfix path with a single reviewer |
| Developer unavailable | Medium / Medium | Named backups, small PRs, written conventions, no one holds un-pushed work overnight | Lead absorbs the ticket or cuts scope |
| Performance of dashboard | Low / Medium | Three queries, indexes, computed in memory; measured in Week 3 | Materialised view or short cache |
| Time-zone and date bugs (overdue) | Medium / Medium | One configured zone, dates stored as `date`, tests with fixed "today" | Hotfix flag in config |
| Scope creep | High / Medium | Written out-of-scope list in the SRS; every addition trades against something | Weekly scope review |

## 8. Team coordination

- **Daily:** stand-up, lead reviews open PRs first thing, a standing 30-minute "ask me anything" slot for unblockers.
- **Mentoring:** pair on the first PR of each developer in an unfamiliar area; code-review comments explain the why and link to the convention; each developer demos their own feature on Friday.
- **Issue resolution:** blocker raised in chat → owner within the hour → decision recorded in the ticket. Technical disagreements are time-boxed to 15 minutes, then the lead decides and writes down the reason.
- **Management reporting:** a one-page Friday report: progress against plan (burn-up), health (green / amber / red by area), decisions made, risks and asks, next week's goals. It reads like the Foreman dashboard on purpose.
- **Retro** at the end of each week: one thing to keep, one to change.
