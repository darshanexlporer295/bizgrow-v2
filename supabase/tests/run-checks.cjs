// Runs the online store checks on a scratch Postgres database.
// Usage (from this folder, after `npm install pg`):
//   DATABASE_URL=postgres://user:pass@host:5432/scratch node run-checks.cjs --scratch
// The database must be empty. The script loads the local auth stand-in, schema.sql,
// patch-07.sql and patch-08.sql (each twice, to prove it is safe to re-run), then store-checks.sql.
// --scratch is required on purpose: the stand-in replaces auth.uid() and must never run on the live project.
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const root = path.resolve(__dirname, '..');
const steps = [
  path.join(__dirname, 'local-auth-shim.sql'),
  path.join(root, 'schema.sql'),
  path.join(root, 'patch-07.sql'),
  path.join(root, 'patch-07.sql'),
  path.join(root, 'patch-08.sql'),
  path.join(root, 'patch-08.sql'),
  path.join(__dirname, 'store-checks.sql'),
];

(async () => {
  if (!process.argv.includes('--scratch')) {
    console.error('Refusing to run: pass --scratch to confirm this is an empty scratch database.');
    process.exit(2);
  }
  if (!process.env.DATABASE_URL) {
    console.error('Set DATABASE_URL to the scratch database.');
    process.exit(2);
  }
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  let last = null;
  for (const f of steps) {
    try {
      const r = await c.query(fs.readFileSync(f, 'utf8'));
      if (f.endsWith('store-checks.sql')) last = Array.isArray(r) ? r[r.length - 1] : r;
      console.log('ran ' + path.basename(f));
    } catch (e) {
      console.error('FAILED in ' + path.basename(f) + ': ' + e.message);
      process.exit(1);
    }
  }
  const rows = last.rows;
  for (const row of rows) console.log((row.ok ? 'PASS ' : 'FAIL ') + row.id + ' ' + (row.detail || ''));
  const passed = rows.filter(r => r.ok).length;
  console.log(`${passed} of ${rows.length} checks passed`);
  await c.end();
  process.exit(passed === rows.length ? 0 : 1);
})().catch(e => { console.error('ERROR ' + e.message); process.exit(1); });
