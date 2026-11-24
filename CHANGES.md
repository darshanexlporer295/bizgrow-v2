# BizGrow v2 - what changed (status: demo build, tested in a browser)

## Copied, not changed
- original/ is the untouched copy of the front-end. Only addition there: assets/icon-512.png, fetched with a plain GET because the manifest names it.

## Changed in v2/
- assets/app.js (2 small patches)
  1. Added `window.BGV2={...}` just before the final `boot()` call, so the new layer can reuse existing actions, forms, api, render, toast, modal and helpers. (Moving it earlier caused a load-time error: "Cannot access 'head' before initialization".)
  2. After each page renders, calls `BGV2.after(S.page, v, args)` so the layer can add panels to existing screens.

## New in v2/
- assets/mock-api.js: stand-in backend in the browser (replaces /api). Example data only, stored in this browser under one key. Covers the routes the screens call, role rules (cashier cannot see totals, cannot delete bills, discount limit), back-date and owner stock rule, udhar with due dates and advance, staff, audit log with undo, export and delete-my-data.
- assets/v2-core.js: hook registry, role table (owner, manager, cashier, stock-keeper, accountant), nav links.
- assets/v2-parse.js: reads a typed or spoken sale line (English, Hinglish, digits, Devanagari and Gujarati digits) and matches product names.
- assets/v2-voice.js: Home "Talk to Chotu" card (tap and speak, or type), confirm sheet with Save and Cancel, rename of the voice helper. Loads products and customers first if they are empty.
- assets/v2-udhar.js: udhar list with days late and a reminder link.
- assets/v2-staff.js: invite, edit, suspend, remove, and a demo role switch.
- assets/v2-audit.js: audit log with undo (owner and manager only).
- assets/v2-summary.js: evening summary.
- assets/v2-privacy.js: export button and delete-my-data (type DELETE to confirm).
- assets/v2-validate.js: number, text and form error checks.
- assets/v2-i18n.js and v2-i18n-extra.js: new text in English, Hindi, Marathi and Gujarati, merged into the existing dictionary.
- assets/v2-layer.css: styles for the new panels, the mic pill, and hides the links the demo cannot serve (invoice, export files, /terms).
- index.html: loads the original scripts plus the v2 files in order.
- dist/bizgrow-v2.html: one self-contained file. CSS and scripts are inlined, the service worker is not registered, and the icons are embedded. This is the file to open.

## Testing done
- Smoke test on the bundle (dist/bizgrow-v2.html) at 390 x 844: 21 of 21 checks pass, no JS errors. Checks cover Home, typed sale to confirm to Save, udhar days late and reminder link, staff invite/suspend/remove, cashier restrictions, audit log and undo, evening summary, and Privacy export/delete buttons.
- Hindi switch passed on the multi-file build (not re-run on the bundle).
- Mic pill and Home screen checked by screenshot at 390 px wide.

## Known gaps (demo)
- Voice input depends on the browser. Typed input always works. Spoken input was not tested with a real microphone.
- No real server, accounts or passwords. Data stays in this browser and is lost if the browser's site data is cleared.
- Invoice, export-file and /terms links are hidden, not built.
- The staff remove check in the smoke test is loose (it checks the name is gone from the list). A manual check showed remove works.
- The export button was not clicked to download a file in the bundle; the export route answers with data.
- Not tested on a real phone, only at 390 px in a desktop browser.
