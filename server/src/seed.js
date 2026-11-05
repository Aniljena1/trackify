import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'node:url';
import { pool, tx } from './db.js';
import { config, today } from './config.js';
import { migrate } from './migrate.js';
import { addDays, daysBetween } from './lib/metrics.js';

export const DEMO_PASSWORD = 'Foreman@123';

const PEOPLE = [
  { key: 'lead', name: 'Priya Sharma', email: 'lead@foreman.dev', role: 'lead', title: 'Technical Team Lead', cap: 12 },
  { key: 'asha', name: 'Asha Menon', email: 'asha@foreman.dev', role: 'developer', title: 'Frontend Engineer', cap: 24 },
  { key: 'ravi', name: 'Ravi Patel', email: 'ravi@foreman.dev', role: 'developer', title: 'Backend Engineer', cap: 15 },
  { key: 'meera', name: 'Meera Iyer', email: 'meera@foreman.dev', role: 'developer', title: 'Full-stack Engineer', cap: 24 },
  { key: 'kabir', name: 'Kabir Nanda', email: 'kabir@foreman.dev', role: 'developer', title: 'QA & DevOps Engineer', cap: 30 },
];

// Offsets are in days relative to "today" so the demo always looks alive.
const PROJECTS = [
  {
    code: 'SFR', name: 'Storefront Revamp', status: 'active', start: -21, due: 14, members: ['asha', 'meera', 'ravi'],
    description: 'Rebuild the customer-facing product, cart and checkout experience on the new design system.',
    tasks: [
      ['Audit current product page performance', 'medium', 'completed', 'asha', -14, 3, 100],
      ['Design token system and theme switcher', 'high', 'completed', 'asha', -8, 5, 100],
      ['Rebuild product listing grid', 'high', 'under_review', 'asha', -1, 5, 95],
      ['Cart drawer with optimistic updates', 'high', 'in_progress', 'meera', 2, 8, 60],
      ['Checkout address autocomplete', 'medium', 'in_progress', 'meera', -2, 5, 40],
      ['Search results relevance tuning', 'medium', 'todo', 'ravi', 6, 5, 0],
      ['Image CDN and lazy loading', 'low', 'in_progress', 'ravi', -1, 3, 30],
      ['Accessibility pass: keyboard and contrast', 'medium', 'todo', 'asha', 10, 5, 0],
      ['Release checklist and rollback plan', 'low', 'todo', null, 13, 2, 0],
    ],
  },
  {
    code: 'PAY', name: 'Payments Gateway Migration', status: 'active', start: -30, due: 5, members: ['ravi', 'kabir', 'meera'],
    description: 'Move card and wallet payments to the new gateway with zero downtime and a dual-write safety net.',
    tasks: [
      ['Map legacy gateway events to the new schema', 'high', 'completed', 'ravi', -20, 5, 100],
      ['Idempotency keys for the charge API', 'high', 'completed', 'ravi', -12, 5, 100],
      ['Webhook signature verification', 'high', 'in_progress', 'ravi', -3, 5, 90],
      ['Refund flow parity tests', 'high', 'in_progress', 'kabir', -1, 8, 50],
      ['3DS challenge handling', 'high', 'in_progress', 'meera', 1, 8, 20, 'Waiting on sandbox credentials from the acquiring bank'],
      ['Reconciliation report job', 'medium', 'todo', 'kabir', 3, 5, 0],
      ['Dual-write cutover runbook', 'medium', 'todo', 'ravi', 4, 3, 0],
      ['Load test at 3x peak traffic', 'medium', 'todo', 'kabir', 5, 5, 0],
      ['Decommission legacy endpoints', 'low', 'todo', null, 5, 2, 0],
    ],
  },
  {
    code: 'MOB', name: 'Mobile Companion App', status: 'active', start: -10, due: 45, members: ['asha', 'meera', 'kabir'],
    description: 'A lightweight companion app for field staff: tasks, offline notes and push alerts.',
    tasks: [
      ['Wireframes and navigation map', 'medium', 'completed', 'asha', -6, 3, 100],
      ['Auth screens with biometric unlock', 'high', 'in_progress', 'asha', 6, 8, 45],
      ['Offline task cache', 'high', 'todo', 'meera', 14, 8, 0],
      ['Push notification service', 'medium', 'todo', 'kabir', 20, 5, 0],
      ['Release pipeline to TestFlight and Play internal', 'low', 'in_progress', 'kabir', 9, 5, 20],
      ['Profile and settings screens', 'low', 'todo', null, 30, 3, 0],
    ],
  },
  {
    code: 'VOP', name: 'Vendor Onboarding Portal', status: 'completed', start: -60, due: -3, members: ['asha', 'ravi'],
    description: 'Self-serve portal for vendors to submit documents and get approved. Shipped.',
    tasks: [
      ['Vendor registration form', 'high', 'completed', 'asha', -50, 5, 100],
      ['Document upload with virus scan', 'high', 'completed', 'ravi', -40, 8, 100],
      ['Approval workflow and email notices', 'medium', 'completed', 'ravi', -25, 5, 100],
      ['Vendor dashboard', 'medium', 'completed', 'asha', -15, 5, 100],
      ['Go-live and handover', 'low', 'completed', 'ravi', -4, 2, 100],
    ],
  },
  {
    code: 'ANL', name: 'Analytics Warehouse', status: 'planning', start: 7, due: 60, members: ['ravi', 'kabir'],
    description: 'Central warehouse for product and billing events. Scoping stage.',
    tasks: [
      ['Warehouse sizing and cost estimate', 'medium', 'todo', 'ravi', 14, 3, 0],
      ['Source system inventory', 'low', 'todo', null, 20, 2, 0],
    ],
  },
];

// Hand-written ledger entries, keyed by "<project index>:<task index>" -> [daysAgo, authorKey, body]
const NOTES = {
  '1:2': [[6, 'ravi', 'Verification passes locally. Rotating the signing secret per environment before I call this done.']],
  '1:4': [[2, 'meera', 'Bank sandbox credentials still have not arrived. Chased twice, escalating via the account manager.']],
  '0:4': [[3, 'meera', 'Autocomplete vendor rate-limits at 5 req/s, adding a debounce and a cached fallback.']],
  '0:2': [[1, 'asha', 'Grid is done and visually checked at all breakpoints. Ready for review.']],
  '2:1': [[2, 'asha', 'Biometric prompt works on iOS. Android fallback to PIN still to do.']],
};

export async function seed({ reset = true } = {}) {
  await migrate();
  const asOf = today();
  const hash = await bcrypt.hash(DEMO_PASSWORD, 10);

  await tx(async (c) => {
    if (reset) await c.query('TRUNCATE task_updates, tasks, project_members, projects, users RESTART IDENTITY CASCADE');

    const ids = {};
    for (const p of PEOPLE) {
      const { rows } = await c.query(
        `INSERT INTO users (name, email, password_hash, role, title, weekly_capacity) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [p.name, p.email, hash, p.role, p.title, p.cap],
      );
      ids[p.key] = rows[0].id;
    }

    for (const [pi, proj] of PROJECTS.entries()) {
      const start = addDays(asOf, proj.start);
      const { rows: [row] } = await c.query(
        `INSERT INTO projects (code, name, description, status, start_date, due_date, owner_id, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::date) RETURNING id`,
        [proj.code, proj.name, proj.description, proj.status, start, addDays(asOf, proj.due), ids.lead, start],
      );
      for (const m of ['lead', ...proj.members]) {
        await c.query('INSERT INTO project_members VALUES ($1,$2)', [row.id, ids[m]]);
      }

      for (const [ti, t] of proj.tasks.entries()) {
        const [title, priority, status, who, dueOff, effort, progress, blockedReason] = t;
        const seq = ti + 1;
        const due = addDays(asOf, dueOff);
        const age = Math.max(daysBetween(start, asOf), 0);
        const { rows: [task] } = await c.query(
          `INSERT INTO tasks (project_id, seq, title, description, priority, status, assignee_id, created_by, due_date,
                              effort, progress, blocked, blocked_reason, created_at, updated_at, completed_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::date,now(), $15) RETURNING id`,
          [
            row.id, seq, title, '', priority, status, who ? ids[who] : null, ids.lead, due,
            effort, progress, Boolean(blockedReason), blockedReason ?? null, start,
            status === 'completed' ? new Date(Date.parse(`${due}T09:00:00Z`) - 86_400_000) : null,
          ],
        );
        await c.query('UPDATE projects SET task_seq = GREATEST(task_seq, $1) WHERE id = $2', [seq, row.id]);

        const log = (daysAgo, author, kind, body, extra = {}) =>
          c.query(
            `INSERT INTO task_updates (task_id, author_id, kind, body, from_status, to_status, progress, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7, now() - make_interval(days => $8::int))`,
            [task.id, ids[author], kind, body, extra.from ?? null, extra.to ?? null, extra.progress ?? null, Math.max(daysAgo, 0)],
          );

        await log(age, 'lead', 'assign', who ? 'Task created and assigned' : 'Task created');
        if (status !== 'todo') {
          await log(Math.max(age - 2, 0), who, 'status', '', { from: 'todo', to: 'in_progress', progress: 0 });
          if (status === 'in_progress' && progress > 0) await log(1, who, 'progress', '', { progress });
          if (status === 'under_review' || status === 'completed') {
            await log(Math.max(1, age - 6), who, 'status', 'Ready for review', { from: 'in_progress', to: 'under_review', progress: 95 });
          }
          if (status === 'completed') {
            await log(Math.max(0, daysBetween(due, asOf)), 'lead', 'status', 'Approved', { from: 'under_review', to: 'completed', progress: 100 });
          }
        }
        if (blockedReason) await log(3, who, 'block', blockedReason);
        for (const [daysAgo, author, body] of NOTES[`${pi}:${ti}`] ?? []) await log(daysAgo, author, 'note', body);
      }
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (config.isProd && !process.argv.includes('--force')) {
    console.error('Refusing to wipe a production database. Re-run with --force if you really mean it.');
    process.exit(1);
  }
  seed()
    .then(() => console.log(`Seeded demo data. Sign in as lead@foreman.dev / ${DEMO_PASSWORD}`))
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
