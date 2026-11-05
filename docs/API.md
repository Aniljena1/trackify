# Trackify API

Base URL `http://localhost:4000/api`. JSON in, JSON out. Send `Authorization: Bearer <token>` on everything except login and health. A Postman collection is in [`Trackify.postman_collection.json`](Trackify.postman_collection.json); run **Login as lead** first.

Errors: `{ "error": { "code": "VALIDATION_ERROR", "message": "…", "details": { "field": "reason" } } }`
Codes: 400 `VALIDATION_ERROR` / `BAD_JSON`, 401 `UNAUTHORIZED`, 403 `FORBIDDEN`, 404 `NOT_FOUND`, 409 `CONFLICT`, 429 `RATE_LIMITED`.

## Auth
| Method | Path | Who | Body / notes |
|---|---|---|---|
| GET | `/health` | public | `{status:"ok"}` |
| POST | `/auth/login` | public | `{email, password}` → `{token, user}` |
| GET | `/auth/me` | any | current user |
| POST | `/auth/change-password` | any | `{currentPassword, newPassword}` → 204 |

## Users
| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/users` | any | Lead: full list with live `workload`. Developer: `{id,name,role,title}` of active users |
| POST | `/users` | lead | `{name,email,password,role?,title?,weeklyCapacity?}` |
| PATCH | `/users/:id` | lead | any of `name,title,role,weeklyCapacity,active,password`. Cannot remove the last lead or deactivate someone with open tasks |

## Projects
| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/projects?status=` | any | Developers get only member projects. Each item has `stats` (progress, planned, counts, overdue, blocked, `health{band,score}`, `forecast`) and `members` |
| GET | `/projects/:id` | any | single project with stats |
| POST | `/projects` | lead | `{code,name,description?,status?,startDate,dueDate,memberIds?}` |
| PATCH | `/projects/:id` | lead | `name,description,status,startDate,dueDate` |
| PUT | `/projects/:id/members` | lead | `{memberIds:[uuid]}` |
| DELETE | `/projects/:id` | lead | only when it has no tasks |

## Tasks
| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/tasks` | any | Query: `project` (uuid or code), `status`, `priority`, `assignee` (uuid, `me`, `unassigned`), `overdue=true`, `blocked=true`, `q`, `sort=priority\|due\|updated`, `limit` (≤200), `offset`. → `{items,total}` |
| POST | `/projects/:projectId/tasks` | lead | `{title,description?,priority?,assigneeId?,dueDate?,effort?}` → task with key `CODE-n` |
| GET | `/tasks/:id` | any (member) | `{task, actions, updates}`. `actions` tells the UI which buttons this user may press |
| PATCH | `/tasks/:id` | lead | `title,description,priority,assigneeId,dueDate,effort` |
| DELETE | `/tasks/:id` | lead | |
| POST | `/tasks/:id/transition` | assignee / lead | `{to, note?}`. See SRS 4.1. Note required when sending back or reopening |
| POST | `/tasks/:id/progress` | assignee / lead | `{progress:0-90, note?}` while In Progress |
| POST | `/tasks/:id/updates` | assignee / lead | `{body}` free-form note |
| POST | `/tasks/:id/block` | assignee / lead | `{blocked:true, reason}` or `{blocked:false}` |

## Dashboard
`GET /dashboard` → `{asOf, scope, totals, overallProgress, projects, workload, attention, dueSoon, reviewQueue, brief, recent}`. `scope` is `team` for leads and `personal` for developers.
`totals`: `activeProjects, assignedTasks, completed, pending, overdue, blocked, underReview, dueThisWeek, unassigned`.
