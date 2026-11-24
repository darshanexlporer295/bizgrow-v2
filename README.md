# BizGrow v2

BizGrow is a simple app for small shops in India. It helps with billing, stock, credit ("udhar") and daily accounts. Version 2 adds:

- **Talk or type a sale.** On the Home screen, say or type something like "2 kg atta 480 rupees", check the sheet, and save.
- **Udhar (credit) list.** Shows who owes money, how many days late they are, and a reminder link.
- **Team and roles.** Owner, manager, cashier, stock-keeper and accountant, each with the screens they are allowed to use. Add, edit, suspend or remove people.
- **Audit log with undo**, an **evening summary**, and **export or delete my data**.
- Text in English, Hindi, Marathi and Gujarati.
- **Sign-up in six short questions** (shop name, trade, city, team size, biggest problem, udhar customers), one per screen. Answers are stored through the demo stand-in, in the shape a real server will use.
- **Consent and privacy.** The sign-up consent box starts unticked, and Continue waits until it is ticked. The Privacy screen has a privacy notice and a consent switch that can be turned off at any time.

## Important: this is a demo

- It runs **in the browser only**. The shop, people and sales are **example data**.
- There is **no real server and no real accounts yet**. The "stand-in" backend is in `v2/assets/mock-api.js`, and it keeps data in the browser it is opened in.
- Clearing the browser's site data deletes the demo data.
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
2. Open the file `v2/dist/bizgrow-v2.html` in Chrome or Edge, on a computer or a phone.
3. Tap **Sign in**. Use `owner@example.com` with the password `example-pass-123`. Any password of 8 or more letters also works in the demo.

That one file is the whole app. You do not need to install anything.

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

1. **A real backend and a new database** (Supabase), so that accounts and shop data are stored safely on a server and not only in one browser.
2. **A public website** for the app, by linking this repository to a free hosting service such as Vercel or Netlify.

Known gaps are listed in `CHANGES.md`. Voice input depends on the browser's microphone support, and typing always works.
