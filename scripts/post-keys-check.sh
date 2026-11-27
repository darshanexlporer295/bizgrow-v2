#!/usr/bin/env bash
# Checks the live BizGrow v2 site after the keys are added in Cloudflare.
# Usage: bash scripts/post-keys-check.sh            (checks https://bizgrow.buildsit.workers.dev)
#        BIZGROW_URL=https://example.workers.dev bash scripts/post-keys-check.sh
# Reads only public answers. It never asks for, prints or stores a key.
# Exit code 0 when every required check passes, 1 when one fails.
# Checks marked "optional" only report: a missing voice key is fine (the phone's own listening is used).

BASE="${BIZGROW_URL:-https://bizgrow.buildsit.workers.dev}"
BASE="${BASE%/}"
SITE_KEY="0x4AAAAAAGTu8oOyY29HFWif"
fails=0

ok()   { printf 'PASS  %s\n' "$1"; }
bad()  { printf 'FAIL  %s\n' "$1"; fails=$((fails + 1)); }
info() { printf 'INFO  %s\n' "$1"; }

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is needed for this check. Install it, then run the script again."
  exit 1
fi

# get URL -> sets BODY and CODE (HTTP status). Times out after 20 seconds.
get() {
  local tmp
  tmp=$(mktemp)
  CODE=$(curl -s -o "$tmp" -w '%{http_code}' --max-time 20 "$1")
  BODY=$(cat "$tmp")
  rm -f "$tmp"
}

echo "Checking $BASE"
echo

# 1. The site loads.
get "$BASE/"
if [ "$CODE" = "200" ]; then ok "home page loads (200)"; else bad "home page loads (got $CODE)"; fi

# 2. The security check is on, with the public site key (required after the keys step).
get "$BASE/api/public/bot-check"
if [ "$CODE" = "200" ] && printf '%s' "$BODY" | grep -q '"enabled":true'; then
  ok "security check is on (bot-check enabled true)"
else
  bad "security check is on (bot-check answered $CODE: enabled is not true; add TURNSTILE_SECRET_KEY, KEYS-GUIDE.md)"
fi
if printf '%s' "$BODY" | grep -q "\"siteKey\":\"$SITE_KEY\""; then
  ok "security check uses the public site key"
else
  bad "security check uses the public site key $SITE_KEY"
fi
if printf '%s' "$BODY" | grep -qi 'secret'; then
  bad "bot-check reply mentions a secret (should never happen)"
else
  ok "bot-check reply has no secret in it"
fi

# 3. Order route is live: GET is refused, as designed.
get "$BASE/api/public/order"
if [ "$CODE" = "405" ]; then ok "order route is live (GET refused with 405)"; else bad "order route is live (got $CODE)"; fi

# 4. Order tracking reaches the database and answers "not found" for a made-up reference.
CODE=$(curl -s -o /tmp/bgv2-track.$$ -w '%{http_code}' --max-time 20 -H 'content-type: application/json' \
  -d '{"shop":"no-such-shop-check","ref":"ZZZZZZ","phone":"9000000000"}' "$BASE/api/public/track")
BODY=$(cat /tmp/bgv2-track.$$ 2>/dev/null); rm -f /tmp/bgv2-track.$$
if [ "$CODE" = "200" ] && printf '%s' "$BODY" | grep -q '"ok":false'; then
  ok "order tracking answers (not found, as expected)"
elif printf '%s' "$BODY" | grep -qi 'something went wrong'; then
  bad "order tracking: the database did not answer (check SUPABASE_URL and the keys in Cloudflare)"
else
  bad "order tracking answers (got $CODE)"
fi

# 5. Voice (optional): reports whether the speech key is set.
get "$BASE/api/voice/config"
if [ "$CODE" = "200" ] && printf '%s' "$BODY" | grep -q '"enabled":true'; then
  ok "voice is on (SARVAM_API_KEY is set)"
elif [ "$CODE" = "200" ]; then
  info "voice is off: SARVAM_API_KEY is not set yet, so the phone's own listening is used (optional)"
else
  bad "voice config answers (got $CODE)"
fi

echo
if [ "$fails" -eq 0 ]; then
  echo "All required checks passed."
  exit 0
fi
echo "$fails required check(s) failed. See the lines marked FAIL, then the steps in docs/KEYS-GUIDE.md."
exit 1
