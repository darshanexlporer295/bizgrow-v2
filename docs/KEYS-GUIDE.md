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
