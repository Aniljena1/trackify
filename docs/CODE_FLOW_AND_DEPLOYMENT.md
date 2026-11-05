# Trackify: code flow (frontend → backend) and deployment

Use this as your interview script. Section 2 walks through four real requests end to end. Section 5 has the questions interviewers usually ask, with short answers.

## 1. The big picture

```
Browser (React SPA)                                   Server (Node + Express)                    Database
───────────────────                                   ───────────────────────                    ────────
Component
  └─ RTK Query hook / mutation
       └─ axiosBaseQuery  ──── axios (adds JWT) ───▶  helmet → cors → json parser
                                                       └─ authenticate (verify JWT, load user)
                                                            └─ route handler
                                                                 ├─ zod validation
                                                                 ├─ permission + visibility checks
                                                                 ├─ lib/rules.js, lib/metrics.js (pure logic)
                                                                 └─ SQL via pg (parameterised) ───▶ PostgreSQL
Redux store ◀── JSON ◀── interceptor normalises errors ◀── JSON / { error: {code,message,details} }
  └─ cache invalidated by tags → active queries refetch → UI re-renders
```

**Two ideas to repeat in the interview**
1. **The server is the authority.** The UI hides buttons the user cannot use, but every rule (who may move a task, valid status jumps, visibility) is enforced again on the server.
2. **Business rules are pure functions** (`rules.js`, `metrics.js`). They are unit tested without a database, and routes only orchestrate.

## 2. Request walk-throughs

### 2.1 Login (`POST /api/auth/login`)

**Frontend**
1. `pages/Login.jsx`: the form calls `useAuth().login(email, password)`.
2. `store/hooks.jsx`: `login` dispatches the thunk `login` from `authSlice.js` and calls `.unwrap()` so the component gets a real success or an error to catch.
3. `authSlice.login` uses the axios instance (`store/http.js`): `http.post('/auth/login', {...})`. The base URL is `/api`. In development Vite proxies `/api` to port 4000 (`vite.config.js`); in production the same server serves both, so there is no CORS.
4. On success the thunk saves the token with `tokenStore.set` (localStorage) and returns the user. The reducer stores `state.auth.user`. React Router then renders the app shell because `user` is set (`App.jsx`).

**Backend**
1. `app.js`: `helmet()` (security headers) → `cors` → `express.json` (100 kb limit) → router `/api/auth`.
2. `routes/auth.js`: `loginLimiter` (30 attempts per 15 minutes per IP).
3. `parse(loginSchema, req.body)` (zod) trims and lower-cases the email and checks its shape. Failure → `HttpError 400` with field details.
4. `SELECT * FROM users WHERE email = $1`. Then `bcrypt.compare(password, hash)`. If the user does not exist, it compares against a **dummy hash** so response time does not reveal whether an email exists. Unknown email, wrong password and inactive account all return the same `401` message.
5. `signToken(user)` (`middleware/auth.js`): `jwt.sign({sub, role}, JWT_SECRET, {HS256, 8h})`. Response: `{ token, user }`. The password hash is never returned (`userDto` whitelists fields).

### 2.2 Opening the dashboard (a read, `GET /api/dashboard`)

**Frontend**
1. `pages/Dashboard.jsx` calls `useGetDashboardQuery()` (generated from `apiSlice.js`).
2. RTK Query checks its cache. If empty, it runs `axiosBaseQuery`, which calls `http({url:'/dashboard'})`. The **request interceptor** adds `Authorization: Bearer <token>`.
3. The endpoint declares `providesTags: ['Dashboard']`. That is how the cache later knows which data a write makes stale.
4. The component renders `isLoading`, error or data states. While a refetch is in flight, the old data stays on screen (no flicker).

**Backend**
1. `app.js` mounts `/api/dashboard` behind `authenticate`.
2. `authenticate`: reads the bearer token, `jwt.verify` (algorithm pinned to HS256), then **re-loads the user from the database**. That means deactivating a user or changing their role takes effect on the next request, not when the token expires. It sets `req.user`.
3. `routes/dashboard.js` runs three queries in parallel (`Promise.all`): projects with stats (`loadProjectsWithStats`), all visible tasks, and the developer list (leads only).
4. **Visibility is a SQL fragment** (`visibleProjectsClause`): leads see everything; a developer only sees projects they are a member of. The same helper is used by the task list and task detail, so there is one rule, not many.
5. Numbers are computed in JavaScript by pure functions in `lib/metrics.js`: effort-weighted progress, expected progress by calendar, health score and band, finish forecast, workload.
6. A developer gets *personal* totals (their tasks); a lead gets team totals. `buildBrief` creates the plain-English headline sentences ordered by urgency.
7. JSON goes back. The frontend renders cards, pace tracks, load strips and the ledger.

### 2.3 Moving a task: the review gate (`POST /api/tasks/:id/transition`)

This is the most important flow. Walk it slowly.

**Frontend**
1. The user opens a task. Clicking a row calls `useOpenTask()` (`hooks.js`), which sets `?task=<id>` in the URL. `App.jsx` sees the param and renders `TaskDrawer`. Because the state is in the URL, a task link can be shared and the back button closes the drawer.
2. `TaskDrawer` runs `useGetTaskQuery(id)`. The response is `{ task, actions, updates }`. `actions` is computed by the server (`taskActions` in `rules.js`) and lists the transitions this user may perform. **The UI renders buttons from that list; it does not duplicate the rules.**
3. If a transition needs a note (send back, reopen), the drawer opens a small form and disables the button until a note is typed. Otherwise it calls the mutation directly.
4. `post('transition', {to, note}, message)` → `useAction()` wraps `mutations.transition({id, to, note}).unwrap()`, shows a toast on success or failure, and returns the result.
5. The mutation sends `POST /tasks/:id/transition`. It declares `invalidatesTags: ['Task','Project','Dashboard','User']`. When it succeeds, RTK Query marks every cached read with those tags stale and **refetches only the queries currently on screen**. That is why the board, the drawer, the project health and the dashboard all update without manual refresh code.

**Backend** (`routes/tasks.js`)
1. `authenticate` → `parse(transitionSchema)` checks `to` is one of the four statuses and `note` is a short string.
2. `tx(async (c) => {...})` opens a **database transaction**.
3. `loadTask(c, id, user, {lock:true})` first runs `SELECT 1 FROM tasks WHERE id=$1 FOR UPDATE`. This row lock stops two people (say a developer and a lead) changing the same task at the same moment. Then it selects the task **with the visibility clause**: a developer from another project gets `404`, not `403`, so the existence of the task is not leaked.
4. `planTransition({task, to, actor, note})` in `lib/rules.js` decides, with no database access:
   - the move must be an allowed edge of the status graph (`todo→in_progress→under_review→completed`, plus the back edges), otherwise `409`;
   - developers may only move their own tasks (`403`) and can never move a task into or out of `completed` (`403`, "approved by a team lead");
   - starting needs an assignee; submitting or completing needs the task not to be blocked;
   - send back and reopen need a note;
   - it returns the side effects: new status, progress (`todo` 0, `under_review` 95, `completed` 100, `in_progress` capped at 90) and whether to set or clear `completed_at`.
5. The handler does one `UPDATE tasks …` and `addUpdate(...)` which inserts a row in `task_updates` (the ledger: who, from, to, note, time). Both are in the same transaction, so you never get a status change without a ledger entry.
6. `COMMIT`, then `respond()` re-reads the task and its updates and returns `{task, actions, updates}`. If anything threw, `ROLLBACK` runs and the central `errorHandler` converts it into `{error:{code,message,details}}` with the right status.

### 2.4 Creating a task (a write with validation and a counter)

1. `forms.jsx → TaskForm` builds the body and calls `createTask({projectId, ...body}).unwrap()` inside `try/catch`. If the API returns `400`, `fail(err)` puts `err.details` onto each field (the red messages under inputs).
2. `POST /projects/:projectId/tasks` is guarded by `requireLead` (403 for developers).
3. In one transaction: `UPDATE projects SET task_seq = task_seq + 1 … RETURNING` gives the next number and locks the project row. That is how keys like `PAY-7` stay unique and gap-free even with simultaneous creates.
4. Business checks: the project exists and is not completed; the deadline lies inside the project window (`assertDueInWindow`); the assignee exists and is active, and is **auto-added** to the project (`ensureMember`).
5. Insert the task, add a ledger entry, commit, return the task with its key.

### 2.5 Errors, end to end
- **Server:** every failure is an `HttpError(status, code, message, details)` or a zod error. One `errorHandler` formats it. Postgres errors are mapped (`23505` duplicate → 409, `22P02` bad uuid → 404). Unknown errors return a generic 500 and are logged, never leaked.
- **Axios interceptor** (`http.js`): turns any failure into `{status, code, message, details}`. A `401` anywhere (except login) calls the registered handler, which dispatches `logout`, clears the token and resets the RTK Query cache (so the next person never sees cached data).
- **UI:** forms show field errors, actions show a toast, pages show an error note with retry.

## 3. Where each requirement lives

| Requirement | Where |
|---|---|
| JWT + RBAC | `middleware/auth.js` (`authenticate`, `requireLead`), role checks inside `rules.js` and routes, visibility in `data.js` |
| Validation + error handling | zod schemas at the top of each route file, `lib/errors.js` |
| Users / projects / tasks / dashboard APIs | `routes/users.js`, `projects.js`, `tasks.js`, `dashboard.js` |
| Relationships | `db/schema.sql`: users ↔ project_members ↔ projects → tasks → task_updates, with CHECK constraints |
| Dashboard updates dynamically | Computed on every request; RTK Query tags refetch after any write |
| Responsive UI | `styles.css` breakpoints at 1100 / 820 / 560 px; bottom navigation on phones |
| Tests | `server/test/metrics.test.js` (pure logic), `api.test.js` (real database, 20 tests total) |

## 4. Frontend state design (say this clearly)

- **Server state** (projects, tasks, dashboard, users) lives in **RTK Query**, using axios through a custom `baseQuery`. It gives caching, loading and error states, de-duplication and tag-based invalidation.
- **Client state** that is not on the server (the logged-in user, toasts) is in plain Redux slices: `authSlice` (async thunks `login`, `restoreSession`, `logout`) and `toastSlice`.
- **UI state** (open dialog, form values, view toggle) stays in component state, and filters and the open task live in the **URL**.
- **Why this split:** do not put server data in hand-written reducers; a cache library does it better with less code.

## 5. Interview questions you should expect

| Question | Answer |
|---|---|
| Why PostgreSQL, not MongoDB? | The data is relational (users, projects, tasks, membership), I need aggregates and constraints (CHECK on status, FK, unique project code). The `task_updates` ledger is append-only rows. |
| Where is the JWT stored and what are the risks? | `localStorage`: simple, but readable by injected scripts (XSS). Mitigations here: helmet, no `dangerouslySetInnerHTML`, React escaping. Production hardening: httpOnly SameSite cookie plus CSRF token, short-lived access token with refresh rotation. |
| How do you stop a developer reading another project's tasks? | The visibility clause is in SQL, so rows are never fetched; a missing row returns 404. It is tested (`api.test.js`). |
| What if two users change one task at once? | Row lock (`SELECT … FOR UPDATE`) inside a transaction; the second request sees the new state and the rules reject invalid moves with 409. |
| How is progress calculated? | Effort-weighted: Σ(effort × credit) ÷ Σ(effort), credit 0 / reported % (max 90) / 0.95 / 1 by status. |
| How is health calculated? | 100 − 1.2 × pace gap − 8 per overdue (max 40) − 5 per blocked (max 15); ≥75 steady, 50-74 drifting, <50 slipping. Documented in the SRS and unit tested. |
| How would you scale it? | Index review, pagination UI, move dashboard aggregates into SQL or a materialised view, add short caching, read replica, rate limits per user, background jobs for notifications. |
| What would you improve with more time? | httpOnly cookie auth, refresh tokens, UI and Playwright tests, audit export, notifications, drag-and-drop with the same server rules, OpenAPI spec generated from the zod schemas. |
| How do you troubleshoot a slow production request? | Check logs and request id, `EXPLAIN ANALYZE` the query, look for missing indexes or N+1 patterns, measure payload size, compare with the browser network tab, then fix and add a regression test. |
| How would you change a status rule in the code? | Edit the `EDGES` table or checks in `lib/rules.js`, add a unit test; the UI follows automatically because it renders from `actions`. |

## 6. Deployment

Foreman ships as **one Docker image**: the API plus the built React app on the same port. One service and one database, no CORS setup.

### 6.1 Required environment variables
| Variable | Value |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `DATABASE_SSL` | `true` for managed databases (Render, Neon, Supabase) |
| `JWT_SECRET` | long random string (the server refuses to start in production without it) |
| `NODE_ENV` | `production` |
| `APP_TZ` | optional, default `Asia/Kolkata` |

The schema is created automatically on startup (`migrate()` in `index.js`). Data is added by the seed script.

### 6.2 Option A: Render (easiest, free tier)
1. Push the project to GitHub (`git init`, commit, create a repo, push). Make sure `.env` and `node_modules` are not committed (the `.gitignore` handles it).
2. In Render choose **New → Blueprint**, select the repository. Render reads `render.yaml` and creates the web service (from the Dockerfile) and a Postgres database, and wires `DATABASE_URL`, `DATABASE_SSL`, a generated `JWT_SECRET` and `NODE_ENV`.
3. Wait for the build. Open `https://<service>.onrender.com/api/health`: you should see `{"status":"ok"}`.
4. **Seed the demo data.** Render's shell is not available on the free plan, so run the seed from your computer against the database's *external* connection string (Render dashboard → database → Connections):
   ```bash
   cd server
   DATABASE_URL="<external connection string>" DATABASE_SSL=true npm run seed -- --force
   ```
   `--force` is required because the script wipes the tables and refuses to run in production mode without it. Do this once, before sharing the link.
5. Open the site URL and sign in as `lead@foreman.dev` / `Foreman@123`. Put the URL into the README (“Deployed demo link”).
6. Notes: free web services sleep when idle, so the first request can take around a minute. Open the link a few minutes before an interview. Free databases may expire after a limited time; check Render's current terms and create the database close to your submission date.

### 6.3 Option B: Neon (database) + any container host
1. Create a free Postgres project at Neon and copy the connection string (it includes `sslmode=require`).
2. Deploy the Dockerfile on Railway, Fly.io, Google Cloud Run or similar and set the variables from 6.1.
3. Seed from your machine exactly like step 4 above.

### 6.4 Option C: Your own server or laptop with Docker Compose
```bash
docker compose up --build -d
docker compose exec app node server/src/seed.js --force
# open http://localhost:4000
```
The compose file starts Postgres 16 (with a health check) and the app, and stores data in a volume.

### 6.5 Release and verification checklist
- `npm test` passes locally.
- `npm run build` succeeds (client build).
- `/api/health` returns ok on the deployed URL.
- Sign in as lead and as a developer; create a task, submit it for review, approve it.
- Check the layout on a phone-sized window.
- The README contains the deployed URL, the sample credentials and the known limitations.
- Rollback: redeploy the previous image or commit. Schema changes are additive, so older code keeps working.

### 6.6 Common problems
| Symptom | Cause and fix |
|---|---|
| Server exits with "JWT_SECRET must be set" | Add the variable (Render blueprint generates it). |
| `no pg_hba.conf entry` or SSL errors | Set `DATABASE_SSL=true`. |
| Blank page after deploy | The client build did not run; the Dockerfile builds it in the first stage. Check the build logs. |
| Login works locally, 401 everywhere in production | Different `JWT_SECRET` between instances, or the seed ran against another database. |
| Seed says "Refusing to wipe a production database" | Add `-- --force`. |
| Everything shows "overdue" or dates look off by a day | Check `APP_TZ`. |
| Free-tier first load is very slow | Cold start; open the link early. |
