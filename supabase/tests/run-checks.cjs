// Runs the online store checks on a scratch Postgres database.
// Usage (from this folder, after `npm install pg`):
//   DATABASE_URL=postgres://user:pass@host:5432/scratch node run-checks.cjs --scratch
//   DATABASE_URL=postgres://user:pass@host:5432/scratch node run-checks.cjs --scratch --lockdown
// The database must be empty. The script loads the local auth stand-in, schema.sql,
// patch-07.sql, patch-08.sql, patch-09.sql, patch-11.sql and patch-12.sql (each twice, to prove it is safe to re-run),
// then supplier-checks.sql (stage 10), store-checks.sql, then client-limit-checks.sql (stage 10).
// --lockdown goes on to test stage 9: patch-10.sql (twice), lockdown-checks.sql, patch-10-rollback.sql (twice),
// then rollback-checks.sql. The lockdown checks run only in that mode.
// --scratch is required on purpose: the stand-in replaces auth.uid() and must never run on the live project.
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const root = path.resolve(__dirname, '..');
const base = [
  path.join(__dirname, 'local-auth-shim.sql'),
  path.join(root, 'schema.sql'),
  path.join(root, 'patch-07.sql'),
  path.join(root, 'patch-07.sql'),
  path.join(root, 'patch-08.sql'),
  path.join(root, 'patch-08.sql'),
  path.join(root, 'patch-09.sql'),
  path.join(root, 'patch-09.sql'),
  path.join(root, 'patch-11.sql'),
  path.join(root, 'patch-11.sql'),
  path.join(root, 'patch-12.sql'),
  path.join(root, 'patch-12.sql'),
  path.join(__dirname, 'supplier-checks.sql'),
  path.join(__dirname, 'store-checks.sql'),
  path.join(__dirname, 'client-limit-checks.sql'),
];
const lockdown = [
  path.join(root, 'patch-10-lockdown.sql'),
  path.join(root, 'patch-10-lockdown.sql'),
  path.join(__dirname, 'lockdown-checks.sql'),
  path.join(root, 'patch-10-rollback.sql'),
  path.join(root, 'patch-10-rollback.sql'),
  path.join(__dirname, 'rollback-checks.sql'),
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
  const lockdownMode = process.argv.includes('--lockdown');
  const steps = lockdownMode ? base.concat(lockdown) : base;
  const finalFile = lockdownMode ? 'rollback-checks.sql' : 'store-checks.sql';
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  let last = null;
  let sidePassed = true;
  for (const f of steps) {
    try {
      const r = await c.query(fs.readFileSync(f, 'utf8'));
      if (path.basename(f) === finalFile) last = Array.isArray(r) ? r[r.length - 1] : r;
      if (path.basename(f) === 'lockdown-checks.sql' || path.basename(f) === 'supplier-checks.sql' || path.basename(f) === 'client-limit-checks.sql') {
        const rows = Array.isArray(r) ? r[r.length - 1].rows : r.rows;
        for (const row of rows) console.log((row.ok ? 'PASS ' : 'FAIL ') + row.id + ' ' + (row.detail || ''));
        const n = rows.filter(x => x.ok).length;
        if (n !== rows.length) sidePassed = false;
        console.log(`${path.basename(f, '.sql')}: ${n} of ${rows.length} checks passed`);
      }
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
  process.exit(passed === rows.length && sidePassed ? 0 : 1);
})().catch(e => { console.error('ERROR ' + e.message); process.exit(1); });
