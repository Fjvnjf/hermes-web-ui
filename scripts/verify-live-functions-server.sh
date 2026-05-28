#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:8648}"
API_URL="${API_URL:-http://127.0.0.1:8642}"
APP_DIR="${APP_DIR:-/home/ubuntu/.hermes/hermes-web-ui}"
WEBUI_HOME="${HERMES_WEB_UI_HOME:-${HERMES_WEBUI_STATE_DIR:-$HOME/.hermes-web-ui}}"

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

fail() {
  echo "LIVE_VERIFY_FAIL: $*" >&2
  exit 1
}

mint_jwt() {
  WEBUI_HOME="$WEBUI_HOME" node --input-type=module <<'NODE'
import { createHmac } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const home = process.env.WEBUI_HOME
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

auth_json() {
  local label="$1"
  local path="$2"
  local output="$tmp_dir/${label//[^a-zA-Z0-9]/_}.json"
  local code
  code="$(curl -fsS -H "Authorization: Bearer $JWT" -o "$output" -w '%{http_code}' "$BASE_URL$path")" \
    || fail "$label request failed"
  [ "$code" = "200" ] || fail "$label returned HTTP $code"
  node -e "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'))" "$output" \
    || fail "$label returned invalid JSON"
  echo "LIVE_VERIFY_OK $label HTTP $code"
}

cd "$APP_DIR"

echo "== Live Hermes Command Center function verification =="
echo "BASE_URL=$BASE_URL"
echo "API_URL=$API_URL"

curl -fsSI "$BASE_URL/" >/dev/null || fail "dashboard root unavailable"
curl -fsS "$API_URL/health" >/dev/null || fail "Hermes API health unavailable"
echo "LIVE_VERIFY_OK dashboard-and-api-health"

JWT="$(mint_jwt)"

auth_json "auth-me" "/api/auth/me"
auth_json "profiles" "/api/hermes/profiles"
auth_json "sessions" "/api/hermes/sessions?limit=1"
auth_json "history" "/api/hermes/history/sessions"
auth_json "config" "/api/hermes/config"
auth_json "models" "/api/hermes/config/models"
auth_json "jobs" "/api/hermes/jobs"
auth_json "kanban-stats" "/api/hermes/kanban/stats"
auth_json "logs" "/api/hermes/logs"
auth_json "usage" "/api/hermes/usage"
auth_json "skills" "/api/hermes/skills"
auth_json "plugins" "/api/hermes/plugins"
auth_json "memory" "/api/hermes/memory"
auth_json "channels" "/api/hermes/channels"
auth_json "group-chat-rooms" "/api/hermes/group-chat/rooms"

JWT="$JWT" BASE_URL="$BASE_URL" node --input-type=module <<'NODE'
import { io } from 'socket.io-client'
import WebSocket from 'ws'

const token = process.env.JWT
const baseUrl = process.env.BASE_URL
const sessionId = `verify_${Date.now().toString(36)}`
const fail = (message) => {
  console.error(`LIVE_VERIFY_FAIL: ${message}`)
  process.exit(1)
}

await new Promise((resolve, reject) => {
  const socket = io(`${baseUrl}/chat-run`, {
    auth: { token },
    query: { profile: 'default' },
    transports: ['websocket', 'polling'],
    timeout: 10000,
    reconnection: false,
  })
  const timer = setTimeout(() => {
    socket.disconnect()
    reject(new Error('chat-run resume timed out'))
  }, 12000)
  socket.once('connect_error', (err) => {
    clearTimeout(timer)
    socket.disconnect()
    reject(err)
  })
  socket.once('connect', () => {
    socket.emit('resume', { session_id: sessionId })
  })
  socket.once('resumed', (payload) => {
    clearTimeout(timer)
    socket.disconnect()
    if (payload?.session_id !== sessionId) {
      reject(new Error('chat-run resumed wrong session'))
      return
    }
    resolve()
  })
}).catch((err) => fail(`chat-run socket failed: ${err.message}`))
console.log('LIVE_VERIFY_OK chat-run-socket-resume')

const wsBase = baseUrl.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:')
await new Promise((resolve, reject) => {
  const ws = new WebSocket(`${wsBase}/api/hermes/terminal?token=${encodeURIComponent(token)}`)
  const timer = setTimeout(() => {
    try { ws.close() } catch {}
    reject(new Error('terminal websocket timed out'))
  }, 12000)
  ws.once('error', reject)
  ws.on('message', (raw) => {
    const text = raw.toString()
    try {
      const msg = JSON.parse(text)
      if (msg.type === 'created') {
        clearTimeout(timer)
        ws.close()
        resolve()
      }
      if (msg.type === 'error') {
        clearTimeout(timer)
        ws.close()
        reject(new Error(msg.message || 'terminal websocket error'))
      }
    } catch {
      // Shell banner or prompt output; wait for the control message.
    }
  })
}).catch((err) => fail(`terminal websocket failed: ${err.message}`))
console.log('LIVE_VERIFY_OK terminal-websocket')

await new Promise((resolve, reject) => {
  const ws = new WebSocket(`${wsBase}/api/hermes/kanban/events?token=${encodeURIComponent(token)}&board=default&profile=default`)
  const timer = setTimeout(() => {
    try { ws.close() } catch {}
    reject(new Error('kanban events websocket timed out'))
  }, 12000)
  ws.once('error', reject)
  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString())
      if (msg.type === 'connected') {
        clearTimeout(timer)
        ws.close()
        resolve()
      }
      if (msg.type === 'error') {
        clearTimeout(timer)
        ws.close()
        reject(new Error(msg.message || 'kanban websocket error'))
      }
    } catch {}
  })
}).catch((err) => fail(`kanban events websocket failed: ${err.message}`))
console.log('LIVE_VERIFY_OK kanban-events-websocket')
NODE

echo "LIVE_FUNCTIONS_VERIFY_DONE"
