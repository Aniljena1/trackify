-- Trackify schema (PostgreSQL 13+). Idempotent: safe to run repeatedly.

CREATE TABLE IF NOT EXISTS users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text        NOT NULL,
  email           text        NOT NULL UNIQUE,            -- stored lower-case
  password_hash   text        NOT NULL,
  role            text        NOT NULL CHECK (role IN ('lead', 'developer')),
  title           text        NOT NULL DEFAULT '',
  weekly_capacity int         NOT NULL DEFAULT 20 CHECK (weekly_capacity BETWEEN 1 AND 100), -- effort points per week
  active          boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS projects (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text        NOT NULL UNIQUE CHECK (code ~ '^[A-Z]{2,5}$'),   -- task keys look like SFR-12
  name        text        NOT NULL,
  description text        NOT NULL DEFAULT '',
  status      text        NOT NULL DEFAULT 'active' CHECK (status IN ('planning', 'active', 'on_hold', 'completed')),
  start_date  date        NOT NULL,
  due_date    date        NOT NULL,
  owner_id    uuid        REFERENCES users(id) ON DELETE SET NULL,
  task_seq    int         NOT NULL DEFAULT 0,                              -- per-project task counter
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (due_date >= start_date)
);

CREATE TABLE IF NOT EXISTS project_members (
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  PRIMARY KEY (project_id, user_id)
);

CREATE TABLE IF NOT EXISTS tasks (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     uuid        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  seq            int         NOT NULL,
  title          text        NOT NULL,
  description    text        NOT NULL DEFAULT '',
  priority       text        NOT NULL DEFAULT 'medium' CHECK (priority IN ('high', 'medium', 'low')),
  status         text        NOT NULL DEFAULT 'todo'   CHECK (status IN ('todo', 'in_progress', 'under_review', 'completed')),
  assignee_id    uuid        REFERENCES users(id) ON DELETE SET NULL,
  created_by     uuid        REFERENCES users(id) ON DELETE SET NULL,
  due_date       date,
  effort         int         NOT NULL DEFAULT 3 CHECK (effort BETWEEN 1 AND 13),   -- effort points, weights progress
  progress       int         NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  blocked        boolean     NOT NULL DEFAULT false,
  blocked_reason text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  completed_at   timestamptz,
  UNIQUE (project_id, seq),
  CHECK (NOT blocked OR (blocked_reason IS NOT NULL AND length(blocked_reason) > 0))
);
CREATE INDEX IF NOT EXISTS tasks_project_idx  ON tasks (project_id);
CREATE INDEX IF NOT EXISTS tasks_assignee_idx ON tasks (assignee_id) WHERE assignee_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS tasks_status_idx   ON tasks (status);
CREATE INDEX IF NOT EXISTS tasks_due_idx      ON tasks (due_date) WHERE status <> 'completed';

-- The "ledger": every status change, progress report, note, assignment and block is one row.
CREATE TABLE IF NOT EXISTS task_updates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id     uuid        NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  author_id   uuid        REFERENCES users(id) ON DELETE SET NULL,
  kind        text        NOT NULL CHECK (kind IN ('note', 'status', 'progress', 'assign', 'block')),
  body        text        NOT NULL DEFAULT '',
  from_status text,
  to_status   text,
  progress    int,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS task_updates_task_idx ON task_updates (task_id, created_at DESC);
