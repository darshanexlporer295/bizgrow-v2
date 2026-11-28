# Keys guide

Where each key goes, and how to add it. Keys are never pasted into a chat, an email, a file or the project's code. They go only into the Cloudflare settings box for the bizgrow-v2 Worker, as a **Secret**.

## SARVAM_API_KEY (voice: understanding spoken words)

Chotu, the voice assistant, can use Sarvam AI to understand spoken Hindi, Hinglish, Marathi, Gujarati and English. Until this key is added, Chotu uses the phone or computer's own listening, as before.

**Cost and free credits (from Sarvam's pricing page, in Indian rupees, excluding GST)**
- New verified users get ₹100 of free credits when they sign up. The credits never expire.
- Speech to text costs about ₹0.49 per minute on the pay-as-you-go plan, billed per second.
- Each tap on the mic is at most 25 seconds, so ₹100 is roughly 200 minutes of talking to Chotu.
- Check the usage and credits on the Sarvam dashboard from time to time.

**Steps**
1. Open the Sarvam dashboard at dashboard.sarvam.ai and sign up. Verify your phone or email as they ask.
2. In the dashboard, open the **API Keys** section and create a new key. Copy it once. Do not paste it anywhere else.
3. Open the Cloudflare dashboard in the browser. On the left, click **Workers & Pages**, then click **bizgrow-v2**.
4. Click **Settings**, then **Variables and Secrets**.
5. Click **Add**. Choose type **Secret**.
   - Name: `SARVAM_API_KEY` (exactly this).
   - Value: the key from step 2.
6. Click **Save** (and **Deploy**, if Cloudflare asks).
7. Keep the key private. If it leaks, delete it in the Sarvam dashboard and create a new one, then update the secret in step 5.

**What the code does with it**
- The key is read only by the Worker on the server. It is never sent to the phone or the browser, never written to a log, and never shown in a reply.
- If the secret is not set, or the call to Sarvam fails, Chotu falls back to the phone or computer's own listening. Nothing breaks.
- Voice clips are sent to Sarvam only while someone is using the mic. Each clip is at most 25 seconds and 1 MB. Only product names are sent along as hints, never customer names.
- Each connection can make at most 20 voice tries per minute.

## TURNSTILE_SECRET_KEY (the security check on the order button)

The store's order form has a small check (Cloudflare Turnstile) that keeps out robots. The public part of it (the site key, `0x4AAAAAAGTu8oOyY29HFWif`) is already in the code. Only the **secret** part is added here. Until it is added, the check stays off and orders still go through.

**Steps**
1. Open the Cloudflare dashboard in the browser. On the left, click **Turnstile**.
2. Click the widget for `bizgrow.buildsit.workers.dev`. Check that its **Site key** starts with `0x4AAAAAAGTu8oOyY29HFWif`.
3. Copy its **Secret key**. This is the secret one, not the Site key. Copy it once and do not paste it anywhere else.
4. Click **Workers & Pages**, then **bizgrow-v2**, then **Settings**, then **Variables and Secrets**.
5. Click **Add**. Choose type **Secret**.
   - Name: `TURNSTILE_SECRET_KEY` (exactly this).
   - Value: the Secret key from step 3.
6. Click **Save** (and **Deploy**, if Cloudflare asks).

**What the code does with it**
- With the secret set, every order must pass the check. A missing or failed check gets the message "Please complete the security check and try again." and nothing is saved.
- If Cloudflare's check service cannot be reached, the order is refused with "The security check could not be reached. Please try again." Nothing is saved.
- With no secret set, the check is off and orders work as before.

## SUPABASE_SERVICE_KEY (optional, only for the patch-10 lockdown)

Add this only if you are going to run `patch-10-lockdown.sql`. Without that step the store works as it does now. This key can do anything in the database, so never put it in a chat, an email, a file or a photo.

**Steps**
1. Open the Supabase dashboard and your project. Click **Project Settings**, then **API**.
2. Find the key named **service_role**. Click **Reveal** or **Copy**.
3. In Cloudflare, go to **Workers & Pages**, **bizgrow-v2**, **Settings**, **Variables and Secrets**.
4. Click **Add**. Choose type **Secret**. Name: `SUPABASE_SERVICE_KEY` (exactly this). Value: the service_role key.
5. Click **Save** (and **Deploy**, if asked).

Run the lockdown only after the security check box shows on your store link and a test order goes through. The full order is in `docs/SETUP-STEPS.md`, Part 6, and `supabase/RUN-ORDER.md`.

## RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET (online payment for plans)

These three turn on the Pay button for plan upgrades. Until all three are set (and `SUPABASE_SERVICE_KEY` is set, see above), the Pay button says "Online payment coming soon", and manual upgrades and promo codes keep working.

The click-by-click steps are in `docs/PAYMENTS-GUIDE.md`. In short:
- `RAZORPAY_KEY_ID` - the Key Id from Razorpay's **API Keys** page in **Test Mode** (starts with `rzp_test_`).
- `RAZORPAY_KEY_SECRET` - the Key Secret shown once when you generate the key. Copy it right away.
- `RAZORPAY_WEBHOOK_SECRET` - a long random text you make up when you create the webhook in Razorpay. It is not the Key Secret.

Add each one in Cloudflare under **Workers & Pages**, **bizgrow-v2**, **Settings**, **Variables and Secrets**, as type **Secret**, with the name typed exactly as above. Then click **Deploy**. Check that `https://bizgrow.buildsit.workers.dev/api/billing/config` says `"enabled":true`.

Never put a key in a chat, an email, a file or a photo. Test keys take fake payments only; use live keys only after Razorpay has finished your account activation, as described in the payments guide.

## Google sign-in (Supabase setting, no key pasted into the app)

The button **Continue with Google** on the first sign-in screen starts the sign-in through Supabase. Nothing secret goes into the app. Until these steps are done, tapping the button says the sign-in is not available yet and the shopkeeper can use email.

The address to use everywhere below is the live site: **https://bizgrow.buildsit.workers.dev**

**Before you start**
- Open the Supabase dashboard for the BizGrow project. Under **Authentication**, open **URL Configuration**.
- Set **Site URL** to `https://bizgrow.buildsit.workers.dev`.
- Under **Redirect URLs**, add `https://bizgrow.buildsit.workers.dev` and save.

**Google**
1. In the Google Cloud Console (console.cloud.google.com), create a project, or pick the BizGrow one.
2. Open **APIs & Services**, then **OAuth consent screen**. Fill in the app name (BizGrow), a support email and the live site address. Save.
3. Open **Credentials**, click **Create credentials**, then **OAuth client ID**. Choose type **Web application**.
4. Under **Authorized redirect URIs**, add the callback address that Supabase shows on its Google provider page. It looks like `https://<your-project-id>.supabase.co/auth/v1/callback`. Copy it from Supabase, not from this guide.
5. Click **Create**. Copy the **Client ID** and the **Client secret** once. Do not paste them into a chat or a file.
6. In Supabase, open **Authentication**, then **Sign In / Providers** (or **Providers**), and open **Google**. Switch it on. Paste the Client ID and the Client secret. Save.
7. Test: open the live site in a private window, tap **Continue with Google**, and sign in with a Google account. The app should open the shop screen.

If a step fails, the message on the screen stays friendly. Check the Redirect URLs in Supabase first: most failures come from a missing or different address.

## After the keys: what to test

Run the check script from a computer with a terminal, in the project folder: `bash scripts/post-keys-check.sh`. It checks the live site and prints one line per check. Then test these by hand, on your phone:

1. Open your store link. The security check box shows above the **Send order on WhatsApp** button.
2. Place a test order with a test name and a test phone number. It shows up in the app's orders list. Then cancel it, so it does not count as a real sale.
3. On the store page, use **Track your order** with that test order's reference and phone number. It shows the status. A wrong reference or phone shows "We could not find an order with that reference and phone number."
4. In the app, tap the mic (Chotu) on the sale screen and say a short sale, for example one item and a quantity. The words should fill in. With the speech key off, the phone's own listening is used instead.
5. In **Settings**, change the language to Hindi, Marathi or Gujarati, and check that the screens change.

If any step fails, send the developer the step number and what you saw on the screen. Do not send any key.
