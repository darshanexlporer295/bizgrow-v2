# BizGrow: setup steps (for the later step, not needed for the demo)

Follow these in order. Do each step once. Nothing here needs you to write code.

**Never paste a secret key, password, or token into a chat, an email, a document, or a file in this project.** Keys go only into the hosting settings box described in step 12.

## Part 1: The database (Supabase)

1. Open your Supabase project in the browser and sign in.
2. On the left, click **SQL Editor**, then **New query**.
3. Open the file `supabase/schema.sql` from this project, copy all of it, and paste it into the editor.
4. Click **Run**. You should see "Success". It is safe to run it again if you ever need to. The file sets its own access rules, so you do not need to change any switch in Supabase.
5. Click **Table Editor** on the left. You should see the list of tables, such as shops, staff, bills and udhar_entries.

Later database steps (the online store and supplier changes): see `supabase/RUN-ORDER.md`. The main one is `supabase/run-all-pending.sql`: paste the whole file into a new query and click **Run**. It is safe to run twice.

## Part 2: The sign-up list (Google Sheet)

6. Create a new Google Sheet. Name it "BizGrow sign-ups". Rename its first tab to **Signups**.
7. In the sheet, click **Extensions**, then **Apps Script**. Delete the sample code and paste all of `google-sheet/apps-script.gs`.
8. Make up one long random text (at least 30 letters and numbers). Keep it on paper or in your password manager. Do not send it to anyone.
9. In Apps Script, click **Project Settings** (the gear icon), then **Script Properties**, then **Add script property**.
   - Name: `SHARED_SECRET`. Value: the random text from step 8.
   - Name: `SHEET_NAME`. Value: `Signups`.
10. Click **Deploy**, then **New deployment**. Choose type **Web app**.
    - Execute as: **Me**.
    - Who has access: **Anyone**. (The secret text is what keeps strangers out.)
11. Click **Deploy**, approve the access screens, and copy the **Web app address** it shows. Keep it for step 13.

## Part 3: Where the keys go

12. Open your hosting settings (the page where the website is hosted, under Environment variables or Secrets).
13. Add four entries, one per line:
    - `SUPABASE_URL`: the project address from Supabase under **Project Settings, then API**.
    - `SUPABASE_SERVICE_KEY`: the **service_role** key from the same page. Treat it like a bank password.
    - `SHEET_WEB_APP_URL`: the web app address from step 11.
    - `SHEET_SHARED_SECRET`: the same random text from step 8.
14. Save. Do not put any of these in the website files or in this project folder.

## Part 4: Check it

15. Ask the developer to connect the server. Until then the demo only keeps data in the browser of the person using it.
16. After the server is connected, sign up with a test account. A new row should appear in the **Signups** tab within a minute.
17. Check that a second test shop cannot see the first shop's bills or customers.

## Part 5: The bot check on the store checkout (Cloudflare)

The store's order button has a small security check (Cloudflare Turnstile). It is off until you add the secret below. Until then orders still work, without the check.

18. Sign in to the Cloudflare dashboard in the browser. On the left, click **Workers & Pages**, then click **bizgrow-v2** (the store's Worker).
19. Click **Settings**, then **Variables and Secrets**.
20. Click **Add**. Choose type **Secret**.
    - Name: `TURNSTILE_SECRET_KEY` (exactly this).
    - Value: the **Secret key** of the Turnstile widget for `bizgrow.buildsit.workers.dev`. Find it under **Turnstile** in the Cloudflare dashboard, then open the widget and copy its **Secret key**.
21. Click **Deploy** (or **Save and deploy**) so the change takes effect.
22. Check that it is on: open a test order page of the store. A small grey security check box should appear just above the **Send order** button. You can also open `https://bizgrow.buildsit.workers.dev/api/public/bot-check` in the browser. It should show `"enabled":true`.
23. Keep the Secret key private. Do not paste it into a chat, an email or a file. After the next site update, repeat step 22 once. If the box has gone, add the secret again in step 20.

## Part 6: Only the store's own server can place orders (optional, Cloudflare and Supabase)

Do this only after Part 5 works: the check box shows on the store link, and a test order goes through. If step 29 is run before steps 25 to 27 are done, customers cannot place orders until they are.

24. In the Supabase dashboard, open your project, then **Project Settings**, then the **API** section. Find the key named **service_role** and click **Reveal** or **Copy**. This key is secret: it can do anything in the database. Never paste it in a chat, an email, a file or a photo.
25. Go back to the Cloudflare dashboard, **Workers & Pages**, **bizgrow-v2**, **Settings**, **Variables and Secrets**.
26. Click **Add**. Choose type **Secret**.
    - Name: `SUPABASE_SERVICE_KEY` (exactly this).
    - Value: the **service_role** key from step 24.
27. Click **Deploy** (or **Save and deploy**).
28. Place a test order from the store link, with a phone number you can use. It should go through and the WhatsApp message should open as before. If it says the order could not be placed, do not go on to step 29; ask the developer.
29. Only when step 28 works, open the Supabase dashboard, then **SQL Editor**, then **New query**. Open the file `supabase/patch-10-lockdown.sql` from the project's GitHub page, copy all of it, paste it in, and click **Run**. It should finish with "Success" and no red text.
30. Place one more test order from the store link. It should still go through. Open the store link and check that the products still show, and that order tracking still works.
31. To undo step 29 at any time: in the **SQL Editor**, click **New query**, open `supabase/patch-10-rollback.sql` from the same GitHub page, copy all of it, paste it in, and click **Run**. Orders then work the old way again. Nothing is deleted.

Notes:
- Running step 29 twice is safe.
- Undoing it does not remove anything you have already saved, and it does not change the owner app.

## If something goes wrong

- Step 4 shows an error: copy the error's first line and send it to the developer. Do not send the whole page if it contains a key.
- The sheet stays empty: check that `SHARED_SECRET` in step 9 matches `SHEET_SHARED_SECRET` in step 13 exactly.
- The check box does not show after step 21: check the name is exactly `TURNSTILE_SECRET_KEY` and that the value is the Secret key, not the Site key. Send the developer the name only, never the value.
- Ask for a lawyer to review the privacy wording before real customers sign up. The app does not give legal advice.
