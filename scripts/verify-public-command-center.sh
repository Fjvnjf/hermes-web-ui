#!/usr/bin/env bash
set -euo pipefail

PUBLIC_URL="${PUBLIC_URL:-${1:-}}"
JWT="${JWT:-}"

if [ -z "$PUBLIC_URL" ]; then
  echo "Usage: PUBLIC_URL=https://example.trycloudflare.com $0" >&2
  echo "   or: $0 https://example.trycloudflare.com" >&2
  exit 2
fi

PUBLIC_URL="${PUBLIC_URL%/}"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

fail() {
  echo "PUBLIC_VERIFY_FAIL: $*" >&2
  exit 1
}

http_get() {
  local label="$1"
  local url="$2"
  local output="$tmp_dir/${label//[^a-zA-Z0-9]/_}.out"
  local code
  code="$(curl -fsS -o "$output" -w '%{http_code}' "$url")" || fail "$label request failed"
  [ "$code" = "200" ] || fail "$label returned HTTP $code"
  echo "$output"
}

extract_asset() {
  grep -Eo '/assets/js/index-[^"]+\.js' "$1" | head -n 1
}

echo "== Public Hermes Command Center verification =="
echo "PUBLIC_URL=$PUBLIC_URL"

health_file="$(http_get health "$PUBLIC_URL/health")"
node -e "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'))" "$health_file" \
  || fail "health returned invalid JSON"
echo "PUBLIC_VERIFY_OK health"

html_file="$(http_get root "$PUBLIC_URL/?cache_bust=$(date +%s)")"
asset="$(extract_asset "$html_file")"
[ -n "$asset" ] || fail "root asset missing"
echo "PUBLIC_ASSET=$asset"

js_file="$(http_get bundle "$PUBLIC_URL$asset?cache_bust=$(date +%s)")"

grep -q "Hermes Command Center" "$js_file" \
  || fail "bundle missing Hermes Command Center branding"
echo "PUBLIC_VERIFY_OK branding"

grep -Eq "Enter Command Center|Sign In" "$js_file" \
  || fail "bundle missing command center login"
echo "PUBLIC_VERIFY_OK command-login"

if grep -Eq "Enter your username and password|Private Command Center|Private dashboard" "$js_file"; then
  fail "bundle still contains removed login copy"
fi
echo "PUBLIC_VERIFY_OK old-login-removed"

if [ -n "$JWT" ]; then
  auth_file="$tmp_dir/auth_me.json"
  code="$(curl -fsS -H "Authorization: Bearer $JWT" -o "$auth_file" -w '%{http_code}' "$PUBLIC_URL/api/auth/me")" \
    || fail "auth-me request failed"
  [ "$code" = "200" ] || fail "auth-me returned HTTP $code"
  node -e "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'))" "$auth_file" \
    || fail "auth-me returned invalid JSON"
  echo "PUBLIC_VERIFY_OK auth-me"
else
  echo "PUBLIC_VERIFY_SKIP auth-me (set JWT to verify protected APIs)"
fi

echo "PUBLIC_COMMAND_CENTER_OK"
