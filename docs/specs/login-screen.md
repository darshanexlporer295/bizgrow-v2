# Spec: blue sign-in screen (first screen for a shopkeeper)

Status: built and checked in the demo. Google and Apple sign-in need switching on in Supabase (not yet done by the member).

## What it does

The first screen is blue, with the BizGrow logo and name, and three large white buttons: Continue with Google, Continue with email. Apple is not shown. A Last used tag shows on the button used last time. Privacy and Terms links sit at the bottom. Hindi, Marathi and Gujarati labels are included.

## Parts

- `v2/assets/app.js` (landing and its helpers, strings in the translation table), `v2/assets/supabase-api.js` (Google sign-in call), `v2/assets/v2-supabase.css`.
- `tests/landing-smoke.js` (browser check, uses the browser helper in `bizgrow-v2-build/cdp.js`).
- `tests/plan-logout-smoke.js` (logout returns to this screen).
- `docs/KEYS-GUIDE.md`, "Google sign-in" and Apple steps.

## Rules

1. Every label and user text is escaped with the app's escape helper; strings come from the translation table.
2. Tapping Google or Apple while the provider is off shows a plain "not available yet, please use email" message and stays on the screen.
3. Email opens the existing sign-in form with a Back button; Back returns here and the email button shows the Last used tag.
4. Logout returns to this screen.
5. The built single-file app (`v2/dist/bizgrow-v2.html`) matches a fresh build of the source (checked 28 Nov 2026 by rebuilding and comparing).

## Verification evidence (28 Nov 2026)

- `node tests/landing-smoke.js`: 21 of 21 pass. Covers blue background, two buttons in order with no Apple, icon sizes and the four-colour Google G, white rounded buttons at least 56 px tall, logo loaded and centred, name BizGrow, Privacy and Terms links, Google not-available message, Terms notice, email form, Last used tag after Back, and email sign-up reachable.
- `plan-logout-smoke.js`: PASS=13 FAIL=0 pass, no page errors.
- Dist rebuilt from source and compared byte for byte with the committed file: matches.

## Not done

- Live Google and Apple sign-in has not been tried (needs the member to switch the providers on in Supabase and add the redirect addresses). Apple is hidden for now.

## Manual steps for the member

1. Follow the Google steps in `docs/KEYS-GUIDE.md` when ready, then test on the live site in a private window.

## Evidence, review round 3 (28 Nov 2026)

- `tests/landing-smoke.js` on a fresh run: 21 of 21 pass. Covers the Google-off message in demo, the email form and Back link, the last-used tag and remembered email, the two buttons with Apple hidden, icon sizes, button size (at least 56 px tall), logo, Terms and Privacy.
- `bizgrow-v2-build/plan-logout-smoke.js`: 13 of 13 pass.
- Not covered by a browser check yet: a language switch on the sign-in screen. Live Google sign-in still needs the provider switched on in Supabase.
- The helper `BGV2.authDone` is kept: it is called by the sign-in screen (app.js), so it is in use.
- The `/public/track` branch in the app's own database wrapper was removed: nothing called it (the store uses the Worker route), and it ran the tracking query without the bot check.
