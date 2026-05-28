#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:8648}"
API_URL="${API_URL:-http://127.0.0.1:8642}"
APP_DIR="${APP_DIR:-/home/ubuntu/.hermes/hermes-web-ui}"
WEBUI_HOME="${HERMES_WEB_UI_HOME:-${HERMES_WEBUI_STATE_DIR:-$HOME/.hermes-web-ui}}"

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

fail() {
  echo "VERIFY_FAIL: $*" >&2
  exit 1
}

check_contains() {
  local label="$1"
  local pattern="$2"
  shift 2
  if command -v rg >/dev/null 2>&1; then
    rg "$pattern" "$@" >/dev/null || fail "$label missing pattern: $pattern"
  else
    grep -R --line-number --binary-files=without-match "$pattern" "$@" >/dev/null || fail "$label missing pattern: $pattern"
  fi
  echo "VERIFY_OK $label"
}

check_not_contains() {
  local label="$1"
  local pattern="$2"
  shift 2
  if command -v rg >/dev/null 2>&1; then
    if rg "$pattern" "$@" >/dev/null; then
      fail "$label found blocked pattern: $pattern"
    fi
  else
    if grep -R --line-number --binary-files=without-match "$pattern" "$@" >/dev/null; then
      fail "$label found blocked pattern: $pattern"
    fi
  fi
  echo "VERIFY_OK $label"
}

check_http() {
  local label="$1"
  local url="$2"
  local output="$tmp_dir/${label//[^a-zA-Z0-9]/_}.out"
  local code
  code="$(curl -fsS -o "$output" -w '%{http_code}' "$url")" || fail "$label request failed"
  [ "$code" = "200" ] || fail "$label returned HTTP $code"
  echo "VERIFY_OK $label HTTP $code"
}

mint_jwt() {
  WEBUI_HOME="$WEBUI_HOME" node --input-type=module <<'NODE'
import { createHmac } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'

const home = process.env.WEBUI_HOME || join(homedir(), '.hermes-web-ui')
const secret = process.env.AUTH_TOKEN || readFileSync(join(home, '.token'), 'utf8').trim()
const dbPath = join(home, 'hermes-web-ui.db')
if (!existsSync(dbPath)) throw new Error(`Web UI DB not found at ${dbPath}`)

const db = new DatabaseSync(dbPath, { readOnly: true })
const user = db.prepare(`
  SELECT id, username, role
  FROM users
  WHERE status = 'active'
  ORDER BY CASE WHEN role = 'super_admin' THEN 0 ELSE 1 END, id ASC
  LIMIT 1
`).get()
if (!user) throw new Error('No active Web UI user found')

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
const iat = Math.floor(Date.now() / 1000)
const header = b64({ alg: 'HS256', typ: 'JWT' })
const payload = b64({
  sub: String(user.id),
  username: String(user.username),
  role: String(user.role),
  type: 'access',
  aud: 'hermes-web-ui',
  iat,
  exp: iat + 600,
})
const unsigned = `${header}.${payload}`
const sig = createHmac('sha256', secret).update(unsigned).digest('base64url')
console.log(`${unsigned}.${sig}`)
NODE
}

auth_get() {
  local label="$1"
  local path="$2"
  local output="$tmp_dir/${label//[^a-zA-Z0-9]/_}.json"
  local code
  code="$(curl -fsS -H "Authorization: Bearer $JWT" -o "$output" -w '%{http_code}' "$BASE_URL$path")" || fail "$label request failed"
  [ "$code" = "200" ] || fail "$label returned HTTP $code"
  node -e "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'))" "$output" || fail "$label returned invalid JSON"
  echo "VERIFY_OK $label HTTP $code"
}

echo "== Verify Hermes Command Center runtime =="
cd "$APP_DIR"

check_http "webui-root" "$BASE_URL/"
check_http "webui-health" "$BASE_URL/health"
check_http "hermes-api-health" "$API_URL/health"

check_contains "built-command-center-branding" "Hermes Command Center" dist/client dist/server
check_not_contains "old-login-copy-removed" "Enter your username and password|Private Command Center" dist/client dist/server

curl -fsS "$BASE_URL/socket.io/?EIO=4&transport=polling&t=$(date +%s)" | head -c 1 | grep -q '0' \
  || fail "Socket.IO polling handshake failed"
echo "VERIFY_OK socketio-polling"

JWT="$(mint_jwt)"

auth_get "profiles-api" "/api/hermes/profiles"
auth_get "sessions-api" "/api/hermes/sessions?limit=1"
auth_get "config-api" "/api/hermes/config"
auth_get "jobs-api" "/api/hermes/jobs"
auth_get "kanban-stats-api" "/api/hermes/kanban/stats"
auth_get "logs-api" "/api/hermes/logs"
auth_get "skills-api" "/api/hermes/skills"
auth_get "plugins-api" "/api/hermes/plugins"
auth_get "group-chat-api" "/api/hermes/group-chat/rooms"

pgrep -af "hermes-web-ui|dist/server" >/dev/null || fail "hermes-web-ui process missing"
pgrep -af "cloudflared" >/dev/null || echo "VERIFY_WARN cloudflared process not found"

echo "VERIFY_DONE"
