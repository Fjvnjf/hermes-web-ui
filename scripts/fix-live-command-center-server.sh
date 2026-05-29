#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/home/ubuntu/.hermes/hermes-web-ui}"
REMOTE_NAME="${REMOTE_NAME:-command-center}"
REMOTE_URL="${REMOTE_URL:-https://github.com/Fjvnjf/hermes-web-ui.git}"
BRANCH="${BRANCH:-chemicon-redesign}"
MIN_REQUIRED_COMMIT="${MIN_REQUIRED_COMMIT:-bf6f445fe50453e826e41d824de0301cb6c5c6e9}"
LOG_FILE="${LOG_FILE:-/tmp/hermes-web-ui-command-center.log}"
CLOUDFLARED_LOG="${CLOUDFLARED_LOG:-/tmp/hermes-cloudflared.log}"

require_command() {
  local name="$1"
  if ! command -v "$name" >/dev/null 2>&1; then
    echo "MISSING_COMMAND=$name" >&2
    exit 1
  fi
}

find_cloudflared() {
  if command -v cloudflared >/dev/null 2>&1; then
    command -v cloudflared
    return 0
  fi
  if [ -x /tmp/cloudflared ]; then
    echo "/tmp/cloudflared"
    return 0
  fi
  return 1
}

wait_for_dashboard() {
  local deadline=$((SECONDS + 45))
  until curl -fsSI http://127.0.0.1:8648 >/dev/null 2>&1; do
    if [ "$SECONDS" -ge "$deadline" ]; then
      echo "DASHBOARD_START_TIMEOUT" >&2
      tail -120 "$LOG_FILE" >&2 || true
      exit 1
    fi
    sleep 1
  done
}

extract_asset() {
  local html_file="$1"
  grep -Eo '/assets/js/index-[^"]+\.js' "$html_file" | head -n 1
}

verify_served_bundle() {
  local base_url="$1"
  local label="$2"
  local html_file="/tmp/hermes-${label}-index.html"
  local js_file="/tmp/hermes-${label}-index.js"
  local asset=""

  curl -fsSL "${base_url}/?cache_bust=$(date +%s)" > "$html_file"
  asset="$(extract_asset "$html_file")"
  if [ -z "$asset" ]; then
    echo "${label}_ASSET_MISSING" >&2
    sed -n '1,80p' "$html_file" >&2
    exit 1
  fi

  curl -fsSL "${base_url}${asset}?cache_bust=$(date +%s)" > "$js_file"
  echo "${label}_ASSET=$asset"

  grep -q "Hermes Command Center" "$js_file" || {
    echo "${label}_MISSING_COMMAND_CENTER" >&2
    exit 1
  }

  grep -Eq "Checking Secure Session|Validating your private command center link|Secure Link Required" "$js_file" || {
    echo "${label}_MISSING_AUTH_TOKEN_GATE" >&2
    exit 1
  }

  if grep -q "Enter your username and password to continue" "$js_file"; then
    echo "${label}_STILL_SERVES_OLD_LOGIN" >&2
    exit 1
  fi
}

current_cloudflare_url() {
  for file in "$CLOUDFLARED_LOG" /tmp/cloudflared.log /tmp/cloudflared*.log "$HOME"/.cloudflared/*.log "$HOME"/.hermes/logs/*.log; do
    if [ -f "$file" ]; then
      grep -Eoh 'https://[a-zA-Z0-9-]+\.trycloudflare\.com' "$file" 2>/dev/null | tail -n 1 || true
    fi
  done | tail -n 1
}

print_autologin_url() {
  local public_url="$1"
  local webui_home="${HERMES_WEB_UI_HOME:-${HERMES_WEBUI_STATE_DIR:-$HOME/.hermes-web-ui}}"

  PUBLIC_URL="$public_url" WEBUI_HOME="$webui_home" node --input-type=module <<'NODE'
import { createHmac, randomBytes, scryptSync } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')
  return `scrypt:${salt}:${hash}`
}

function ensureAuthUser(db) {
  const active = db.prepare(`
    SELECT id, username, role
    FROM users
    WHERE status = 'active'
    ORDER BY CASE WHEN role = 'super_admin' THEN 0 ELSE 1 END, id ASC
    LIMIT 1
  `).get()
  if (active) return active

  const total = db.prepare('SELECT COUNT(*) AS count FROM users').get()?.count || 0
  if (Number(total) > 0) throw new Error('No active Web UI user found')

  const now = Date.now()
  const username = 'command_center_admin'
  const randomPassword = randomBytes(32).toString('hex')
  db.prepare(`
    INSERT INTO users (username, password_hash, role, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(username, hashPassword(randomPassword), 'super_admin', 'active', now, now)
  const created = db.prepare('SELECT id, username, role FROM users WHERE username = ?').get(username)
  db.prepare(`
    INSERT INTO user_profiles (user_id, profile_name, is_default, created_at)
    VALUES (?, ?, ?, ?)
  `).run(created.id, 'default', 1, now)
  return created
}

const publicUrl = process.env.PUBLIC_URL || 'http://127.0.0.1:8648'
const home = process.env.WEBUI_HOME
const secret = process.env.AUTH_TOKEN || readFileSync(join(home, '.token'), 'utf8').trim()
const dbPath = join(home, 'hermes-web-ui.db')
if (!existsSync(dbPath)) throw new Error(`Web UI DB not found: ${dbPath}`)

const db = new DatabaseSync(dbPath)
db.exec('PRAGMA busy_timeout=5000')
const user = ensureAuthUser(db)

const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url')
const iat = Math.floor(Date.now() / 1000)
const header = b64({ alg: 'HS256', typ: 'JWT' })
const payload = b64({
  sub: String(user.id),
  username: String(user.username),
  role: String(user.role),
  type: 'access',
  aud: 'hermes-web-ui',
  iat,
  exp: iat + 60 * 60 * 24 * 30,
})
const unsigned = `${header}.${payload}`
const sig = createHmac('sha256', secret).update(unsigned).digest('base64url')
console.log(`AUTOLOGIN_URL=${publicUrl}/#/?token=${unsigned}.${sig}`)
NODE
}

ensure_cloudflare_tunnel() {
  local cloudflared_bin=""
  local url=""

  if ! cloudflared_bin="$(find_cloudflared)"; then
    echo "CLOUDFLARED_MISSING"
    return 0
  fi

  echo "CLOUDFLARED_BIN=$cloudflared_bin"
  if ! pgrep -af "cloudflared tunnel --url http://localhost:8648" >/dev/null 2>&1; then
    pkill -f "cloudflared tunnel --url http://127.0.0.1:8648" || true
    nohup "$cloudflared_bin" tunnel --url http://localhost:8648 > "$CLOUDFLARED_LOG" 2>&1 &
    sleep 8
  fi

  url="$(current_cloudflare_url)"
  if [ -n "$url" ]; then
    echo "CLOUDFLARE_URL=$url"
    verify_served_bundle "$url" "PUBLIC"
    if [ -x scripts/verify-public-command-center.sh ]; then
      PUBLIC_URL="$url" bash scripts/verify-public-command-center.sh
    fi
    curl -fsSI "$url" | sed -n '1,12p'
    print_autologin_url "$url"
  else
    echo "CLOUDFLARE_URL=unknown"
  fi
}

require_command git
require_command node
require_command npm
require_command curl
require_command sudo

cd "$APP_DIR"

echo "== Command Center live fix =="
echo "APP_DIR=$APP_DIR"
echo "REMOTE_URL=$REMOTE_URL"
echo "BRANCH=$BRANCH"
echo "BEFORE_COMMIT=$(git rev-parse HEAD 2>/dev/null || true)"
git status --short --branch || true
node -v
npm -v

node_major="$(node -p "Number(process.versions.node.split('.')[0])")"
if [ "$node_major" -lt 23 ]; then
  echo "NODE_TOO_OLD=$(node -v)" >&2
  exit 1
fi

sudo -n true

if [ -n "$(git status --porcelain)" ]; then
  git stash push -u -m "pre-command-center-live-fix-$(date +%Y%m%d-%H%M%S)"
fi

git remote get-url "$REMOTE_NAME" >/dev/null 2>&1 || git remote add "$REMOTE_NAME" "$REMOTE_URL"
git remote set-url "$REMOTE_NAME" "$REMOTE_URL"
git fetch "$REMOTE_NAME" "$BRANCH"
git checkout -B "$BRANCH" "$REMOTE_NAME/$BRANCH"
git reset --hard "$REMOTE_NAME/$BRANCH"
git merge-base --is-ancestor "$MIN_REQUIRED_COMMIT" HEAD
echo "CHECKED_OUT_COMMIT=$(git rev-parse HEAD)"

npm install
npm run build

grep -R "Hermes Command Center" dist/client >/dev/null || {
  echo "DIST_MISSING_COMMAND_CENTER" >&2
  exit 1
}

grep -RE "Checking Secure Session|Validating your private command center link|Secure Link Required" dist/client >/dev/null || {
  echo "DIST_MISSING_AUTH_TOKEN_GATE" >&2
  exit 1
}

if grep -R "Enter your username and password to continue" dist/client >/dev/null; then
  echo "DIST_STILL_HAS_OLD_LOGIN" >&2
  exit 1
fi

sudo npm install -g "$APP_DIR" --force

echo "== Restart dashboard from repo build, not stale global dist =="
pgrep -af "hermes-web-ui|dist/server/index.js" || true
pkill -f "/usr/lib/node_modules/hermes-web-ui/dist/server/index.js" || true
pkill -f "$APP_DIR/dist/server/index.js" || true
pkill -f "hermes-web-ui start" || true
sleep 2

nohup /usr/bin/node "$APP_DIR/dist/server/index.js" > "$LOG_FILE" 2>&1 &
sleep 2
wait_for_dashboard

echo "== Verify local served bundle =="
verify_served_bundle "http://127.0.0.1:8648" "LOCAL"
curl -fsS http://127.0.0.1:8642/health || curl -fsS http://127.0.0.1:8642/
curl -fsSI http://127.0.0.1:8648 | sed -n '1,12p'

if [ -f scripts/verify-command-center-server.sh ]; then
  bash scripts/verify-command-center-server.sh
fi
if [ -f scripts/verify-live-functions-server.sh ]; then
  bash scripts/verify-live-functions-server.sh
fi

echo "== Verify public tunnel =="
ensure_cloudflare_tunnel

echo "== Running processes =="
pgrep -af "node .*hermes-web-ui|dist/server/index.js|cloudflared tunnel" || true
tail -80 "$LOG_FILE" || true

echo "LIVE_COMMAND_CENTER_OK commit=$(git rev-parse HEAD)"
