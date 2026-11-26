# BizGrow v2

BizGrow is a simple app for small shops in India. It helps with billing, stock, credit ("udhar") and daily accounts. Version 2 adds:

- **Talk or type a sale.** On the Home screen, say or type something like "2 kg atta 480 rupees", check the sheet, and save.
- **Udhar (credit) list.** Shows who owes money, how many days late they are, and a reminder link.
- **Team and roles.** Owner, manager, cashier, stock-keeper and accountant, each with the screens they are allowed to use. Add, edit, suspend or remove people.
- **Audit log with undo**, an **evening summary**, and **export or delete my data**.
- Text in English, Hindi, Marathi and Gujarati.
- **Sign-up in six short questions** (shop name, trade, city, team size, biggest problem, udhar customers), one per screen. Answers are stored through the demo stand-in, in the shape a real server will use.
- **Consent and privacy.** The sign-up consent box starts unticked, and Continue waits until it is ticked. The Privacy screen has a privacy notice and a consent switch that can be turned off at any time.

## Status: stage 1 (real sign-in)

- Sign-in is with **Google**, through the BizGrow Supabase project. The first login creates your shop. Sign-up asks six short questions after a consent step.
- Only the public key is in the front end (`v2/assets/config.js`). Never add a secret or service key to any file.
- Shop data is **not complete yet**. Sales, udhar, stock, expenses, staff, audit, summary and exports come in stage 2 (listed in `CHANGES.md`). Until then those screens show empty lists or a "comes in the next stage" message.
- The **demo** is still there. Open the address with `?demo=1` added to force it. It uses example data kept in the browser, and clearing the browser's site data deletes it.

### Building the single file (developers)

From the repository root:

    node /workspace/agent/bizgrow-v2-build/build.js v2 v2/dist/bizgrow-v2.html

This inlines the styles and scripts into `v2/dist/bizgrow-v2.html`. Commit the rebuilt file with any change to `v2/`.

### Checking the online store SQL (developers)

Run only on an empty scratch database, never on the live project. Needs Node and the `pg` package:

    NODE_PATH=/path/with/node_modules DATABASE_URL=postgres://user:pass@host:5432/scratch node supabase/tests/run-checks.cjs --scratch

It prints PASS or FAIL for each check and a total. The acceptance criteria that these checks map to are in `docs/specs/online-store.md`.

### Setting up the database (once)

1. In the Supabase SQL Editor, run `supabase/schema.sql`, then `supabase/patch-01.sql`.
   Later database steps are listed in `supabase/RUN-ORDER.md` (the main one is `supabase/run-all-pending.sql`).
2. In Supabase, Authentication settings: turn on the **Google** provider (its client ID and secret are entered there, not in files), and add the live site address to the allowed redirect addresses.
3. Open the live site address and tap **Continue with Google**.

Google sign-in works only from the live website address, not from a file opened on your computer.

## Important: before real customers sign up

- The privacy notice and consent wording are a draft. **A lawyer should review them before any real customer signs up.** This project does not claim legal compliance. The notice describes what the app does; it is not legal advice.
- Hindi, Marathi and Gujarati wording is a first draft and needs a native-speaker check.

## Files for the later server step

| File | What it is |
| --- | --- |
| `supabase/schema.sql` | The database tables, with row-level security and access rules set in the file. Not yet run on a live project. |
| `google-sheet/apps-script.gs` | Receives sign-up rows into a Google Sheet. Not yet run on a live account. |
| `docs/SETUP-STEPS.md` | Plain numbered steps for the database, the Sheet, and where keys go (hosting settings only, never in files). |

## How to open it

1. Download this repository (green **Code** button, then **Download ZIP**), and unzip it.
2. Live site: open the live address and tap **Continue with Google**.
3. Demo: open `v2/dist/bizgrow-v2.html` in Chrome or Edge, add `?demo=1` to the address, and sign in with `owner@example.com` and the password `example-pass-123`.

The single file is the whole app. You do not need to install anything.

## What is in this repository

| Folder or file | What it is |
| --- | --- |
| `v2/dist/bizgrow-v2.html` | **The file to open.** The whole new app in one file. |
| `v2/` | The new version, as separate pieces (pages, scripts, styles, icons). |
| `v2/assets/mock-api.js` | The demo stand-in for a server. Example data only. |
| `original/` | The untouched copy of the original BizGrow front-end, for comparison. |
| `CHANGES.md` | What changed, what was tested, and what is still missing. |
| `README.txt` | The short note from the first demo. |

## What comes next

1. **Stage 2**: sales and bills, udhar, stock, expenses, staff, audit log, summary and exports on the real database. The full list is in `CHANGES.md`.
2. **Hosting**: the live site address is set in the hosting settings, and must also be added to the Supabase redirect addresses.

Known gaps are listed in `CHANGES.md`. Voice input depends on the browser's microphone support, and typing always works.
