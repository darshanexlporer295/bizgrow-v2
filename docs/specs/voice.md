# Spec: Chotu voice (speak an order or sale, the app writes it)

Status: built and checked. Worker route and browser checks pass. The live speech key is optional: without it Chotu uses the phone or computer's own listening.

## What it does

A shopkeeper taps the mic and speaks Hindi, Marathi, Gujarati or English (or a mix). The clip goes to the Worker, which sends it to the speech service and returns the text. The app then fills the sale or order.

## Parts

- `worker/index.mjs`: `transcribeVoice` (route `/api/voice/transcribe`) and the config route `/api/voice/config`.
- `worker/billing.mjs`: `signedInUser` (checks the session with the sign-in service).
- `supabase/patch-18.sql`: `voice_take` (shared per-person count, stored in the database) and `voice_attempts`. Revoked from public and anon.
- `v2/assets/v2-voice.js`: mic, clip, language, top-3 picks and corrections.
- `tests/voice-smoke.mjs`, `tests/voice-accuracy.mjs`, `tests/voice-heldout.mjs`, `tests/voice-heldout-2.mjs`, `tests/voice-heldout-3.mjs`, `tests/voice-baseline/`.

## Rules

1. Only a signed-in user may call transcribe. An anonymous call, or a bad token, gets HTTP 401 `login`, is checked before the body is read, and makes no speech call.
2. Size: a clip over 1 MB, or a body over about 1.06 MB, gets 413. The size is counted while the body is read, so a missing or false length header cannot get past it. Clips are at most 25 seconds.
3. Rate: 20 tries per minute per signed-in person, counted in the database so it holds across every Worker instance. Over the limit gets 429. If the database check cannot be made, the route fails closed (503), it does not let the call through.
4. Languages: only `unknown`, `hi-IN`, `en-IN`, `mr-IN`, `gu-IN` are accepted; anything else gets 400.
5. Speech key off: 503 `voice_off`, and the app falls back to the device's own listening.
6. Only product names are sent as hints, never customer names.

## Verification evidence (28 Nov 2026)

- `node tests/voice-smoke.mjs`: 49 of 49 pass. Covers the 401 for anonymous and bad tokens (including an oversize anonymous call, which still gets 401 with no body read), the 413 for an oversize clip and a streamed oversize body with no length header, the 20-then-429 limit shared across connections, and no speech call on refusal.
- Browser voice check (`bizgrow-v2-build/voice-browser-smoke.js`): 16 of 16 pass after the change (commit 876e576).
- `node tests/voice-accuracy.mjs`: 158 of 158 pass (was 157 of 158). The Marathi miss "गीता चा उधार तांदूळ पाच किलो" is fixed: a possessive "चा" right after a customer's name is no longer read as tea. Fixed in the same round: Marathi plurals (कांदे, बटाटे), possessive or dative endings on names (सुनिताचे, सुनीताला), hundreds written as one word (दोनशे, पाचशे), numbers 11 to 19 and the round tens, and the stock word डालो.
- Held-out sets (phrases written apart from the tuning set, in Marathi, Hindi, Gujarati and English):
  - `tests/voice-heldout.mjs`: 39 of 39 on the first run, before any change.
  - `tests/voice-heldout-2.mjs`: 23 of 27 on the first run (the misses were plural nouns, a name with a possessive ending, and "दोनशे"). Those gaps were then fixed in the parser, so this set is no longer clean; it now reads 27 of 27.
  - `tests/voice-heldout-3.mjs`: a clean third set. 24 of 29 on its first run (before the fixes). After the fixes it reads 28 of 29; it is no longer clean either.
- Known gap, not fixed: "ત્રણ ત્રણ" (three each, said after two items) gives the first item the number and the second item 1.
- Honest limit: the phrases in these sets were written by the same person who wrote the parser, so they are not a stranger's speech. Real shop speech will be checked only with the live speech key or real use.

## Not done

- The speech key has not been tried on a live call (needs the member's key in the Worker secrets).
- "ત્રણ ત્રણ" (each) quantity.
- The rate limit is per person, not per shop; a shared shop login can use the same 20 a minute.

## Manual steps for the member

1. Run `supabase/run-all-pending.sql` in the Supabase SQL editor (safe to repeat), so the shared voice limit exists.
2. Optional: add the speech key as a Worker secret (see `docs/KEYS-GUIDE.md`, SARVAM_API_KEY).
