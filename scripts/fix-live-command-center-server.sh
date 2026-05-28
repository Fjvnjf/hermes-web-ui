#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/home/ubuntu/.hermes/hermes-web-ui}"
REMOTE_NAME="${REMOTE_NAME:-command-center}"
REMOTE_URL="${REMOTE_URL:-https://github.com/leadrescuepro/hermes-web-ui.git}"
BRANCH="${BRANCH:-chemicon-redesign}"
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
    curl -fsSI "$url" | sed -n '1,12p'
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
echo "CHECKED_OUT_COMMIT=$(git rev-parse HEAD)"

npm install
npm run build

grep -R "Hermes Command Center" dist/client >/dev/null || {
  echo "DIST_MISSING_COMMAND_CENTER" >&2
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

echo "== Verify public tunnel =="
ensure_cloudflare_tunnel

echo "== Running processes =="
pgrep -af "node .*hermes-web-ui|dist/server/index.js|cloudflared tunnel" || true
tail -80 "$LOG_FILE" || true

echo "LIVE_COMMAND_CENTER_OK commit=$(git rev-parse HEAD)"
