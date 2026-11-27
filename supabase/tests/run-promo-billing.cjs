// Runs the promo-code, plan-payment and plan-source checks on a scratch Postgres database (patch-15, patch-16, patch-17).
// Usage (from this folder, after `npm install pg`):
//   DATABASE_URL=postgres://user:pass@host:5432/scratch node run-promo-billing.cjs --scratch            (fresh scratch DB)
//   DATABASE_URL=postgres://user:pass@host:5432/scratch node run-promo-billing.cjs --scratch --p07     (p07 scratch DB)
// The database must be empty. Loads the local auth stand-in, schema.sql, supabase-defaults.sql, and (for --p07)
// patch-01 to patch-07. Then one shop from before patch-14 is made (it gets the old All Features default),
// then run-all-pending.sql (patch-08 to patch-17) runs TWICE, then promo-billing-checks.sql, then a real race:
// 12 separate connections use one code that allows 3 uses. Exactly 3 must succeed.
// --scratch is required on purpose: the stand-in replaces auth.uid() and must never run on the live project.
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const root = path.resolve(__dirname, '..');
const pending = path.join(root, 'run-all-pending.sql');
const p07 = process.argv.includes('--p07');
const earlier = [1, 2, 3, 4, 5, 6, 7].map(n => path.join(root, 'patch-' + String(n).padStart(2, '0') + '.sql'));
const PRE14 = `
insert into auth.users (id, email) values ('16200000-0000-0000-0000-00000000000a', 'legacy-owner@test.local') on conflict (id) do nothing;
insert into public.shops (id, name) values ('16200000-0000-0000-0000-000000000001', 'P16 Legacy Shop A') on conflict (id) do nothing;
insert into public.staff (shop_id, auth_user_id, name, role, active) values ('16200000-0000-0000-0000-000000000001', '16200000-0000-0000-0000-00000000000a', 'Legacy Owner', 'owner', true)
  on conflict (shop_id, auth_user_id) do nothing;`;
const steps = [
  path.join(__dirname, 'local-auth-shim.sql'),
  path.join(root, 'schema.sql'),
  path.join(__dirname, 'supabase-defaults.sql'),
  ...(p07 ? earlier : []),
  PRE14,
  pending, pending,
  path.join(__dirname, 'promo-billing-checks.sql'),
];
const RACERS = 12;
const LIMIT = 3;

async function race(c) {
  const shop = i => '16100000-0000-0000-0000-' + String(i).padStart(12, '0');
  const user = i => '16000000-0000-0000-0000-' + String(i).padStart(12, '0');
  for (let i = 1; i <= RACERS; i++) {
    await c.query(`insert into auth.users (id, email) values ($1, $2) on conflict (id) do nothing`, [user(i), 'racer' + i + '@test.local']);
    await c.query(`insert into public.shops (id, name) values ($1, 'Race shop') on conflict (id) do nothing`, [shop(i)]);
    await c.query(`insert into public.staff (shop_id, auth_user_id, name, role, active) values ($1, $2, 'Racer', 'owner', true)
                   on conflict (shop_id, auth_user_id) do nothing`, [shop(i), user(i)]);
  }
  await c.query(`insert into public.promo_codes (code, plan, duration_days, max_uses, active) values ('P15-RACE', 'growth', 30, $1, true)`, [LIMIT]);

  const results = await Promise.all(Array.from({ length: RACERS }, async (_, k) => {
    const i = k + 1;
    const r = new Client({ connectionString: process.env.DATABASE_URL });
    await r.connect();
    try {
      await r.query('begin');
      await r.query(`select set_config('request.jwt.claim.sub', $1, true)`, [user(i)]);
      const res = await r.query(`select public.redeem_promo_code($1::uuid, 'P15-RACE') as reply`, [shop(i)]);
      await r.query('commit');
      return res.rows[0].reply;
    } catch (e) {
      await r.query('rollback').catch(() => {});
      return { ok: false, error: e.message };
    } finally {
      await r.end();
    }
  }));
  const wins = results.filter(x => x && x.ok === true).length;
  const used = (await c.query(`select used_count from public.promo_codes where code = 'P15-RACE'`)).rows[0].used_count;
  const rows = (await c.query(`select count(*)::int as n from public.promo_redemptions p join public.promo_codes c on c.id = p.promo_id where c.code = 'P15-RACE'`)).rows[0].n;
  const okAll = wins === LIMIT && used === LIMIT && rows === LIMIT;
  console.log((okAll ? 'PASS ' : 'FAIL ') + 'P18 ' + `${RACERS} shops at once: ${wins} succeeded, used_count ${used}, redemptions ${rows} (limit ${LIMIT})`);
  return okAll;
}

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
  for (const f of steps) {
    try {
      const text = f === PRE14 ? PRE14 : fs.readFileSync(f, 'utf8');
      const r = await c.query(text);
      if (path.basename(f) === 'promo-billing-checks.sql') {
        const rows = (Array.isArray(r) ? r[r.length - 1] : r).rows;
        for (const row of rows) console.log((row.ok ? 'PASS ' : 'FAIL ') + row.id + ' ' + (row.detail || ''));
      }
      console.log('ran ' + (f === PRE14 ? 'pre-patch-14 shop' : path.basename(f)));
    } catch (e) {
      console.error('FAILED in ' + (f === PRE14 ? 'pre-patch-14 shop' : path.basename(f)) + ': ' + e.message);
      process.exit(1);
    }
  }
  const sqlRows = (await c.query('select id, ok, detail from p15_results order by id')).rows;
  const raceOk = await race(c);
  const passed = sqlRows.filter(r => r.ok).length + (raceOk ? 1 : 0);
  const total = sqlRows.length + 1;
  console.log(`${passed} of ${total} checks passed`);
  await c.end();
  process.exit(passed === total ? 0 : 1);
})().catch(e => { console.error('ERROR ' + e.message); process.exit(1); });
