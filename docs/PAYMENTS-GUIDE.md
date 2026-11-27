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

1. Open BizGrow, go to Settings, then Plan, and press **Pay** for a plan.
2. In the Razorpay test window, use Razorpay's published test card (search "Razorpay test
   cards" on their docs site). Use any future expiry date and any CVV.
3. The plan should change after the payment finishes. If the window closed early, the
   webhook should still change it within a few minutes.
4. In the Razorpay dashboard, under **Payments** (test mode), you should see the payment.

Test payments are fake. Nothing is charged.

---

## Part 5 - Going live (only when you are ready)

1. In Razorpay, finish the account activation (KYC) so live mode is allowed.
2. Switch to live mode and generate live keys (they start with `rzp_live_`).
3. Create a live webhook with the same URL and a new secret.
4. Replace the three Cloudflare secrets with the live values, then deploy.

Do not mix test and live keys.

---

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
