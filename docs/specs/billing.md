# Spec: online payment for plan upgrades (Razorpay)

Status: built and tested against a local Razorpay simulator (26 of 26) and the Worker mocks (30 of 30). Switched off until the Razorpay keys are added. Not yet tested against Razorpay's real test mode (see "Not done").

## What it does

An owner pays for the Growth or All Features plan from the Plan page. Razorpay takes the payment. BizGrow then turns the plan on for 30 days and records the payment. The price is set in the database, never in the browser.

## Parts

- `worker/billing.mjs`: the Worker code. Routes:
  - `GET /api/billing/config`: says whether payment is on. Sends no secret.
  - `POST /api/billing/create-order`: owner only. Makes a Razorpay order for the plan price from the database and returns the order id and the public key id.
  - `POST /api/billing/verify`: owner only. Called after checkout. Checks the checkout signature, then reads the payment back from Razorpay.
  - `POST /api/billing/webhook`: called by Razorpay. Checked with the webhook secret over the raw body.
- `supabase/patch-15.sql`, `patch-16.sql`, `patch-17.sql`, `patch-19.sql`: `plan_payments` table (locked from app roles), `billing_begin_order`, `billing_attach_order`, `billing_mark_paid`, and the owner notice (patch-19).
- `v2/assets/v2-billing.js` and `v2/assets/v2-i18n-billing.js`: the Plan page buttons and messages.
- Tests: `tests/billing-worker-smoke.mjs` (mocked Razorpay and database), `tests/razorpay-sim.mjs` (stateful Razorpay and database simulator, 26 checks), `supabase/tests/promo-billing-checks.sql` (run by `supabase/tests/run-promo-billing.cjs`).

## Rules

1. Off by default. Without `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET` set as Worker secrets, every billing route answers "coming soon" (503) and calls nothing.
2. Price: the amount and currency come from the `plan_payments` row written by the database for the plan. The browser's amount or plan name is ignored.
3. Checkout signature: HMAC-SHA256 of `order_id|payment_id` with the key secret, compared in constant time.
4. Webhook signature: HMAC-SHA256 of the raw request body with the webhook secret, compared in constant time. Any byte change fails.
5. Verify reads the payment back from Razorpay. The payment must belong to the same order, be `captured`, and its amount and currency must match the database row. If not captured, the answer is "pending" (202) and the plan does not change.
6. Only the shop owner can confirm a payment from the browser (checked in the database).
7. Idempotent: `billing_mark_paid` locks the order row. The same payment id again changes nothing and answers OK. A different payment id for an order already paid is refused ("This order was already paid.").
8. Never move a shop down. If the shop already has the same or a higher plan, the payment is recorded as paid, the plan is not changed, the audit log gets a line, and the owner sees a notice on the Plan page (patch-19). The notice stays until a later payment raises the plan.
9. Errors shown to the owner are plain sentences. Raw Razorpay or database text is never sent to the browser.
10. Secrets are Worker secrets only. Nothing in the repo or the browser.

## Verification evidence (this session, 28 Nov 2026)

- `node tests/billing-worker-smoke.mjs`: 30 of 30 pass (mocked). Covers: checkout and webhook signature vectors, one-byte body change, wrong secret, payment off with no network call, create-order price from the database, login required before any database call, plain messages, duplicate webhook (same ids sent twice, both answer 200), replay of a second payment on a paid order (refused), tampered amount after signing (refused before any call), re-signed with the wrong secret (refused), verify ignores browser amount and plan, verify with a payment for another order (refused), owner notice flag returned.
- `node tests/razorpay-sim.mjs`: 26 of 26 pass (first run, no edits after). A stateful fake Razorpay (real basic-auth check against the fake key pair, orders and payments, injected 401, 429, 500, timeout, network error and malformed answers) and a fake database that copies the rules of `billing_mark_paid` in patch-17. Covers: order create sends the key pair and a timeout signal; a wrong key secret is refused by Razorpay and nothing is attached; each Razorpay fault gives the plain message and attaches nothing; a staff login is refused by the database; full checkout (order, payment, signature, read-back, plan changes once); signature from another secret; a failed payment waits; a smaller amount is refused; Razorpay timeout on the read-back; database timeout and 500 with plain messages; a second payment on a paid order refused; verify sent twice; webhook replayed three times (plan changes once); order.paid; a failed-payment webhook ignored; webhook amount mismatch refused; webhook after a browser confirm is a no-op; webhook with no payment id; database unreachable on webhook; and a sweep: none of the 45 answers in the run shows a secret, raw Razorpay text or raw database text.
- Known quirk (not a money risk): a repeat of an already applied payment returns OK, and the Worker then reports `plan_changed: true` because the database leaves that key out on a repeat. The plan itself is not changed twice (the sim checks this). Fixing the flag needs a database patch, so it is recorded here and not changed.
- `supabase/tests/run-promo-billing.cjs --scratch` on a fresh scratch database and on a p07 scratch database: 61 of 61 checks pass on both. Includes P19 (a late payment for a lower plan does not move the shop) and P51 (the owner's plan data carries the notice).
- Scenario runs on fresh and p07 scratch databases: all check files pass, including patch-18 limits 12 of 12.

## Not done

- A real Razorpay test-mode payment (create order, pay with a test card, verify, webhook). It needs the member's Razorpay test key id and secret and the webhook secret. Without them it cannot run. The step-by-step TEST-MODE checklist is in `docs/PAYMENTS-GUIDE.md` (Part 4). Once the keys are set as Worker secrets, run it and record the order id, payment id and the resulting plan here.
- The Growth and All Features prices are assumed (Rs 499 and Rs 999 per 30 days, patch-15). The member must confirm them before going live.
- Razorpay checkout script integrity. `https://checkout.razorpay.com/v1/checkout.js` is an unversioned file that Razorpay updates, so a pinned hash would break checkout whenever they change it. Accepted risk: the script is loaded only from Razorpay's own domain, and every payment is checked on the server anyway, so a changed script cannot set a plan or amount.
- The owner notice cannot be dismissed. It clears only when a later payment raises the plan.

## Manual steps for the member

1. Create Razorpay test-mode keys and a webhook in the Razorpay dashboard. Webhook URL: the app's `/api/billing/webhook`. Event: payment captured.
2. Set `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` as Worker secrets (not in any file).
3. Run `supabase/run-all-pending.sql` (safe to run again).
