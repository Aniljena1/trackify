# Trackify: Software Requirements Specification

Version 1.0 · Project & Task Management System · Candidate submission for Technical Team Lead (IVTEX)

## 1. Scope and objectives

Trackify is a web application where an organisation plans projects, assigns tasks to developers, tracks progress against deadlines and reviews delivery health.

**Objectives**
1. Give a team lead one screen that answers "are we on track, and what needs me today?"
2. Give developers one screen that answers "what should I work on next?"
3. Make progress *honest*: completion is approved by a lead, and every change is written to an immutable ledger.

**Out of scope (v1):** file attachments, comments with @-mentions, email/Slack notifications, time tracking, multi-tenant organisations, SSO, password reset by email, drag-and-drop board.

## 2. Users and roles

| Role | Description |
|---|---|
| **Lead** (Admin / Team Lead) | Creates and manages projects, people and tasks. Approves completion. Sees all projects. |
| **Developer** (Team Member) | Sees projects they belong to. Works on tasks assigned to them. |

A person has exactly one role. At least one active lead must always exist.

## 3. Functional requirements

### 3.1 Authentication
- FR-A1 Sign in with email and password; response carries a signed JWT (HS256, 8 h default).
- FR-A2 Every API route except `/auth/login` and `/health` requires a valid token. The user record is re-read on each request, so deactivation or a role change applies immediately.
- FR-A3 Passwords: 8-72 characters with at least one letter and one digit, stored as bcrypt hashes. Users can change their own password.
- FR-A4 Login is rate limited (30 attempts / 15 min / IP) and gives the same error for unknown email and wrong password.

### 3.2 Permissions matrix

| Action | Lead | Developer |
|---|:-:|:-:|
| View all projects / tasks | ✔ | Only projects they are a member of |
| Create / edit / delete project, manage members | ✔ | ✘ |
| Create / edit / delete task, assign, set priority, deadline, effort | ✔ | ✘ |
| Move task between statuses | Any task | Own tasks only, never into or out of Completed |
| Approve (Under Review → Completed), send back, reopen | ✔ | ✘ |
| Report progress, post updates, flag / clear blocker | Any task | Own tasks only |
| Manage users | ✔ | ✘ |
| Dashboard | Team-wide | Personal (own tasks, own projects) |

### 3.3 Projects
- FR-P1 Fields: code (2-5 capital letters, unique), name, description, status (`planning`, `active`, `on_hold`, `completed`), start date, due date, owner, members.
- FR-P2 Create, edit and view. Delete is allowed only when the project has no tasks.
- FR-P3 A project cannot be marked `completed` while it has open tasks.
- FR-P4 The due date cannot move earlier than the latest task deadline.
- FR-P5 A member cannot be removed while they hold open tasks in the project.

### 3.4 Tasks
- FR-T1 Fields: project, per-project sequence (key such as `PAY-3`), title, description, priority (High / Medium / Low), status, assignee, deadline, effort (1-13 points), progress, blocker flag and reason.
- FR-T2 Statuses: **To Do, In Progress, Under Review, Completed**.
- FR-T3 Assigning a task adds the assignee to the project automatically.
- FR-T4 Filter by project, priority, status, assignee (including "me" / "unassigned"), overdue, blocked, and free-text search. Sort by priority, deadline or last update.
- FR-T5 Every state change, progress report, assignment, blocker and free-form note is appended to the task's ledger with author and time.

### 3.5 Dashboard
Leads see team-wide figures, developers see their own. Updated on every request (no caching).
- Total active projects
- Total assigned tasks, split into completed, pending and overdue
- Blocked and under-review counts, tasks due in 7 days, unassigned tasks (lead)
- Per-project progress, health and finish forecast
- Overall progress across active projects
- Workload per developer (lead)
- "Needs attention", "Due this week", review queue and latest ledger entries
- A plain-English brief of the most important facts, ordered by urgency

## 4. Business rules

### 4.1 Status flow (the review gate)
```
To Do ⇄ In Progress → Under Review → Completed
              ↑___________|              |
              ↑__________________________| (reopen)
```
| From → To | Who | Conditions |
|---|---|---|
| To Do → In Progress | assignee, lead | Task has an assignee |
| In Progress → To Do | assignee, lead | Progress resets to 0 |
| In Progress → Under Review | assignee, lead | Not blocked |
| Under Review → Completed | **lead only** | Not blocked. Sets progress 100 and the completion time |
| Under Review → In Progress (send back) | assignee, lead | **A note is required** |
| Completed → In Progress (reopen) | **lead only** | **A note is required** |

Any other jump (for example To Do → Completed) is rejected with `409`.

### 4.2 Progress
- While In Progress, the developer reports 0-90 %. 90 is the cap; the last stretch belongs to review.
- Under Review is stored as 95 %. Completed is 100 %.
- A task's contribution to project progress is `effort × credit`, where credit = 0 (To Do), reported % (In Progress), 0.95 (Under Review), 1 (Completed).
- **Project progress** = Σ(effort × credit) ÷ Σ(effort), rounded. A large task therefore moves the needle more than a small one.

### 4.3 Deadlines and overdue
- A task is **overdue** when it has a deadline before today and is not Completed. "Today" is evaluated in the configured time zone (`APP_TZ`, default Asia/Kolkata).
- A task deadline must fall inside the project's start-to-due window.

### 4.4 Blockers
Flagging a blocker requires a reason. A blocked task cannot be submitted or completed. Completed tasks cannot be flagged.

### 4.5 Project health
```
expected  = days elapsed ÷ project length (0-100 %)
pace gap  = max(0, expected − progress)
score     = 100 − 1.2 × pace gap − 8 × overdue tasks (max 40) − 5 × blocked tasks (max 15)
```
| Band | Rule |
|---|---|
| Steady | score ≥ 75 |
| Drifting | 50 ≤ score < 75 |
| Slipping | score < 50 |
| Done | project completed or every task completed |
| Paused | project on hold |
| Queued | start date is in the future |
| No tasks | active project with no tasks |

### 4.6 Finish forecast
After at least 3 elapsed days and some progress: `velocity = progress ÷ days elapsed`; `finish = today + (100 − progress) ÷ velocity`. The forecast reports the date and the slip (days after due date, negative = early).

### 4.7 Workload
`committed = Σ effort of open tasks due within 7 days (overdue included)`. `load % = committed ÷ weekly capacity`. Light < 60 %, Balanced 60-100 %, Overloaded > 100 %.

## 5. Data requirements

| Entity | Key fields (mandatory in bold) | Relationships |
|---|---|---|
| users | **name, email (unique), password_hash, role**, title, weekly_capacity, active | owns projects, assigned tasks |
| projects | **code (unique), name, status, start_date, due_date**, description, owner_id, task_seq | has members, has tasks |
| project_members | **project_id, user_id** (composite key) | many-to-many users ↔ projects |
| tasks | **project_id, seq, title, priority, status, effort, progress**, assignee_id, due_date, blocked, blocked_reason, completed_at | belongs to project, assigned to user; unique (project, seq) |
| task_updates | **task_id, kind, body**, author_id, from_status, to_status, progress, created_at | belongs to task |

Integrity is enforced in the database (CHECK constraints for enums, ranges and "blocked requires a reason"; foreign keys with sensible delete behaviour; unique constraints) as well as in the API. Full DDL: [`schema.sql`](schema.sql).

## 6. Non-functional requirements

| Area | Requirement |
|---|---|
| Security | bcrypt hashing; JWT with server-side user re-check; role checks on every mutation; parameterised SQL only; helmet headers; login rate limit; 100 kb body limit; CORS allow-list; no secrets in the repo; production refuses to start without `JWT_SECRET` |
| Validation | Every request body and query string is validated with zod; errors return field-level details with HTTP 400 |
| Error handling | Uniform JSON `{ error: { code, message, details } }`. 401 unauthenticated, 403 forbidden, 404 missing or not visible, 409 rule conflict, 500 never leaks internals |
| Maintainability | Business rules live in pure, unit-tested modules (`lib/rules.js`, `lib/metrics.js`); routes stay thin; one schema file |
| Responsiveness | Works from 360 px phones (bottom navigation, stacked layouts) to wide desktops; keyboard accessible; respects reduced-motion |
| Performance | Dashboard computed from three queries; list endpoints paginated (limit ≤ 200); indexes on project, assignee, status and open deadlines |
| Portability | Runs with Node 20+ and PostgreSQL 13+; Docker image and compose file included |

## 7. Assumptions and design decisions

| # | Assumption / decision | Why |
|---|---|---|
| A1 | Developers can see all tasks in their projects but act only on their own | Transparency inside a team, safety outside it |
| A2 | Only a lead may complete a task (review gate) | The brief lists "Under Review" as a status; a gate gives it meaning |
| A3 | "Assigned tasks" on the dashboard counts tasks that have an assignee; unassigned work is shown separately | Matches the wording of the requirement |
| A4 | Effort points weight progress | A one-hour fix should not move a project as much as a two-week feature |
| A5 | In-progress progress caps at 90 % | Prevents "99 % done" tasks that sit forever |
| A6 | Projects with tasks cannot be deleted, only put on hold or completed | Preserves history |
| A7 | JWT kept in `localStorage` | Simple for an SPA. Trade-off: exposed to XSS. A production hardening step would be httpOnly cookies plus CSRF protection |
| A8 | PostgreSQL chosen over MongoDB | Strongly relational data (users ↔ projects ↔ tasks), aggregate queries and CHECK constraints |

## 8. Acceptance criteria

1. A lead can sign in, create a project with a team, add a task with priority, deadline and assignee, and see it on the dashboard immediately.
2. A developer sees only their projects. Opening a task from another project returns "not found".
3. A developer can start a task, report progress, flag and clear a blocker, and submit for review. The same developer cannot mark it Completed (403).
4. A lead sees the task in the review queue, can send it back only with a note, and can approve it. The project's progress and health update on the next dashboard load.
5. A task with a past deadline that is not completed appears as overdue in the list, the board, the dashboard counts and the brief.
6. Invalid input (short title, effort 99, deadline outside the project window, duplicate project code, weak password) is rejected with a clear field message.
7. The UI is usable on a 390 px wide screen.
8. `npm test` passes (20 automated tests covering rules, metrics, auth, RBAC, lifecycle, filters, dashboard).
