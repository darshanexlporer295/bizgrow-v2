# Spec: promo codes (plan upgrades by code)

Status: built and verified on scratch databases. Not yet run on the live database (member runs `supabase/run-all-pending.sql`).

## What it does

An owner types a promo code on the Plan page. If the code is valid, the shop gets the code's plan for the code's number of days. Codes are checked and applied in the database, never in the browser.

## Parts

- `supabase/patch-14.sql` to `patch-17.sql`: `promo_codes`, `promo_redemptions`, `promo_attempts` tables (RLS on, grants revoked from public, anon and authenticated) and `redeem_promo_code`.
- `supabase/patch-18.sql`: global caps on failed tries and the internal functions closed to anon (see Rules 3 to 5).
- `supabase/tests/promo-billing-checks.sql` (run by `supabase/tests/run-promo-billing.cjs`) and `supabase/tests/limits-18-checks.sql`.
- `v2/assets/v2-plan.js` and the Plan page: the code box and messages.

## Rules

1. An owner only. The database checks the caller is an owner of the shop (`staff.role = 'owner'`).
2. Per person: 10 failed tries per 15 minutes for one signed-in user (patch-17).
3. Per code, across every account: 50 failed tries per code per hour (patch-18). A second owner account cannot keep guessing once the code has hit the cap.
4. Across all codes, across every account: 300 failed tries per hour (patch-18).
5. When any cap is hit, the reply is the same generic message as the per-person limit. It does not say which cap or which code exists.
6. The code row is locked while it is checked, so two taps cannot use up the last use twice.
7. A code never moves a shop down. A code for a lower plan than the shop's current plan is refused. An upgrade replaces the plan; an extension of the same plan adds days.
8. Internal functions (names that start with an underscore, such as `_sync_shop_plan`) are not executable by `public` or `anon` (patch-18 revokes them). The smoke check fails if anon can run them.

## Verification evidence (this session, 28 Nov 2026)

- `supabase/tests/limits-18-checks.sql` on a fresh scratch database and a p07 scratch database: 12 of 12 pass on both. Covers the per-code cap across five accounts (L01), the global cap (L02 to L04), the voice shared count, and anon denied on `voice_take` and the underscore functions.
- `supabase/tests/run-promo-billing.cjs --scratch` on fresh and p07: 61 of 61 pass on both. Covers upgrade, extend, refuse-lower and the owner-only check.
- Scenario runs on fresh and p07 scratch databases: all check files pass.

## Not done

- No check on the live database. The member must run `supabase/run-all-pending.sql` (safe to repeat) and then the member can check one code himself.
- Per-person and per-code caps are per database; there is no Cloudflare rate-limit rule on the promo route because the promo route is a database call from the signed-in app, not a Worker route.

## Manual step for the member

1. Run `supabase/run-all-pending.sql` in the Supabase SQL editor (safe to run again).

## Evidence, review round 3 (28 Nov 2026)

Run on a fresh scratch database with `supabase/tests/run-promo-billing.cjs --scratch` (all patches, then the checks): 61 of 61 pass.

- **Concurrency.** P18: 12 shops redeem the same limited code at the same moment; exactly 3 succeed (the limit is 3), used count 3, redemptions 3.
- **Expiry.** P44: a code past its end date is refused with a plain message; P45 and P46: a wrong or empty code is refused.
- **30-day end.** P40 and P43: a 30-day code gives 30 days left and returns the shop to Free when it runs out; a code with no end date shows "for good".
- **Abuse.** P47: all 8 refused attempts (wrong, ended, empty and similar) get plain messages; the global cap of 50 failed tries per code an hour and 300 overall is checked by `supabase/tests/limits-18-checks.sql` (12 of 12, earlier run).
- **Not run here.** The live project. The owner runs `supabase/run-all-pending.sql` first.
