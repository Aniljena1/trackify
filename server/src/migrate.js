import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pool } from './db.js';

const schemaPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'db', 'schema.sql');

export async function migrate() {
  await pool.query(readFileSync(schemaPath, 'utf8'));
}

// Run directly: `npm run migrate`
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  migrate()
    .then(() => console.log('Schema is up to date.'))
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
