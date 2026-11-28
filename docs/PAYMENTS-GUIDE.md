# Online payments (Razorpay) - step by step

This guide turns on online payment for plan upgrades. You do it yourself, in your own
Razorpay account and in your own Cloudflare account. Nobody needs your password, and
keys never go into chat, email or the code.

Until you finish, the Pay button says "Online payment coming soon". Manual upgrades and
promo codes keep working the whole time.

Note: Razorpay and Cloudflare change their screens from time to time. The names of buttons
below may be a little different. Look for the words that match most closely.

---

## Part 1 - Make a Razorpay account and get test keys

1. Open https://dashboard.razorpay.com and sign up, or log in if you have an account.
2. Finish the basic business details when Razorpay asks. You can skip the live-money
   parts for now. Test mode works without them.
3. Look for the switch that says **Test Mode** (often at the top or the side of the
   screen). Turn it on. Test keys start with `rzp_test_`.
4. Go to **Account & Settings**, then **API Keys**.
5. Click **Generate Key** (in Test Mode).
6. Razorpay shows two things:
   - **Key Id** - starts with `rzp_test_`.
   - **Key Secret** - shown once. Copy it into a safe place (a password manager) right away.
     If you lose it, generate a new key pair.

Keep these two open in a safe place for Part 3. Do not paste them into WhatsApp or any chat.

---

## Part 2 - Make the webhook

A webhook is how Razorpay tells BizGrow "this payment went through", even if the
customer closed the page early.

1. In the Razorpay dashboard, go to **Account & Settings**, then **Webhooks**.
2. Click **Add New Webhook**.
3. **Webhook URL** - paste this exactly:

       https://bizgrow.buildsit.workers.dev/api/billing/webhook

4. **Secret** - make up a long random text (at least 20 letters and numbers). This is
   your webhook secret. Write it in your password manager. It is different from the Key Secret.
5. **Active events** - tick **payment.captured** and **order.paid** (if you see them).
   Leave the rest unticked.
6. Click **Create Webhook** (or Save). Make sure its status shows as active.

---

## Part 3 - Put the three secrets into Cloudflare (you paste them, not us)

The secrets live only in Cloudflare, as encrypted Worker secrets. They are never in the repo.

1. Log in at https://dash.cloudflare.com.
2. Go to **Workers & Pages**, then click **bizgrow-v2**.
3. Go to **Settings**, then **Variables and Secrets** (or **Variables**).
4. Click **Add** and choose type **Secret**. Add these three, one at a time:

   | Name (type it exactly) | Value to paste |
   |---|---|
   | `RAZORPAY_KEY_ID` | the Key Id (starts with `rzp_test_`) |
   | `RAZORPAY_KEY_SECRET` | the Key Secret from Part 1 |
   | `RAZORPAY_WEBHOOK_SECRET` | the webhook secret you made in Part 2 |

5. Click **Deploy** (or **Save and deploy**) so the new values take effect.

Also check that `SUPABASE_SERVICE_KEY` is already there (it is used in the setup guide,
Part 3). Online payment stays off without it.

After saving, open https://bizgrow.buildsit.workers.dev/api/billing/config in a browser.
It should say `"enabled":true`. If it says `false`, one of the three names is off, or the
service key is missing. Check the spelling, then deploy again.

---

## Part 4 - Test with a test card (no real money)

1. Open BizGrow, go to Settings, then Plan, and press **Pay for Growth** (or the plan you want). The Pay buttons appear only when the shop owner is signed in and the plan is higher than the current one.
2. In the Razorpay test window, use Razorpay's published test card (search "Razorpay test
   cards" on their docs site). Use any future expiry date and any CVV.
3. The plan should change after the payment finishes. If the window closed early, the
   webhook should still change it within a few minutes.
4. In the Razorpay dashboard, under **Payments** (test mode), you should see the payment.

Test payments are fake. Nothing is charged.

### TEST-MODE checklist (tick each line; the only thing you do is paste the keys)

Before you start: Parts 1 to 3 are done (test keys, webhook, three Cloudflare secrets), and
`supabase/run-all-pending.sql` has been run once in the Supabase SQL editor (safe to run again).

| # | Step | What you should see | If not |
|---|------|---------------------|--------|
| 1 | Open `https://bizgrow.buildsit.workers.dev/api/billing/config` in a browser | A line that says `"enabled":true` and no key in the text | Keys are missing or misspelt in Cloudflare (Part 3) |
| 2 | Sign in as the shop **owner**, open Settings, then Plan | A **Pay for Growth** button | A staff login sees no Pay button, by design |
| 3 | Press **Pay for Growth** | The Razorpay test window opens with the plan price. The price in the SQL is an assumed Rs 499 (see the note in `supabase/run-all-pending.sql`); confirm it is the price you want before going live | Note the message on the screen and send it to us; do not retry many times |
| 4 | Pay with a published Razorpay test card, any future expiry, any CVV | The window closes and the Plan page says the plan is updated | Wait one minute, then reload the Plan page (the webhook may finish it) |
| 5 | Reload the Plan page | The current plan shows Growth with an end date about 30 days away | If it still shows the old plan, go to step 6 |
| 6 | Razorpay dashboard, test mode, **Webhooks**, then the webhook's log | A `payment.captured` delivery with a green status (200) | A red status: check the webhook secret matches Part 3 exactly |
| 7 | Razorpay dashboard, test mode, **Payments** | The test payment with the same amount, status Captured | No payment: the checkout did not finish; repeat step 3 |
| 8 | Optional: repeat steps 3 to 4 with the same shop | The Plan page says the plan is unchanged, and no second charge is made by BizGrow | This is expected: the shop is already at that plan |

What the checks above prove, and what they do not: the code path (order, signature, payment read-back, webhook,
database update, refusals for tampering) is tested without Razorpay, in `tests/razorpay-sim.mjs` (26 of 26) and
`tests/billing-worker-smoke.mjs` (30 of 30). Steps 1 to 7 are the only proof that Razorpay's real servers agree
with that. Record the date, the order id and the payment id in `docs/specs/billing.md` (Evidence section) after
a successful run. Do not write the keys in that file.

---

## Part 5 - Going live (only when you are ready)

1. In Razorpay, finish the account activation (KYC) so live mode is allowed.
2. Switch to live mode and generate live keys (they start with `rzp_live_`).
3. Create a live webhook with the same URL and a new secret.
4. Replace the three Cloudflare secrets with the live values, then deploy.

Do not mix test and live keys.

---

## Promo codes and the platform owner (BizGrow team only)

Promo codes are made on the **Promo codes** link at the bottom of Settings, then Plan. That link shows only to the platform owner.

- The platform owner login is **revobuildsit@gmail.com**. Sign in to BizGrow once with that email first.
- Then, once, run `supabase/make-platform-owner.sql` in the Supabase **SQL Editor**. It must say "platform owner added".
- A shop owner types a code on Settings, then Plan. The code turns on its plan for the shop, for the number of days set (or for good), and stops when it reaches its maximum number of shops or its end date.
- Switch a code off at any time from the same screen. Shops that already used it keep their plan until its end.

## What BizGrow does with a payment (for your information)

- It creates the order with the price from the plan settings. The browser cannot change the price.
- After the payment, it checks the signature with your Key Secret, then reads the payment
  back from Razorpay. The amount and currency must match.
- It upgrades the plan only once, even if the webhook and the page both report it.
- Card numbers never reach BizGrow or the database. Razorpay's checkout handles them.

## If something goes wrong

- "Coming soon" still shows: a secret is missing or misspelled in Cloudflare (Part 3).
- Webhook shows errors in the Razorpay dashboard: check the URL and the webhook secret.
- Customer paid but the plan did not change: wait five minutes, then check the payment in
  Razorpay. Send us the Razorpay payment id (it starts with `pay_`), not any key.
