#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/home/ubuntu/.hermes/hermes-web-ui}"
REMOTE_NAME="${REMOTE_NAME:-deploy}"
REMOTE_URL="${REMOTE_URL:-https://github.com/Fjvnjf/hermes-web-ui.git}"
BRANCH="${BRANCH:-chemicon-redesign}"
MIN_REQUIRED_COMMIT="${MIN_REQUIRED_COMMIT:-5da6c9658c0a14cbaf8e90a9f6413b95cd6b4a40}"
LOG_FILE="${LOG_FILE:-/tmp/hermes-web-ui.log}"

require_command() {
  local command="$1"
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Missing required command: $command" >&2
    exit 1
  fi
}

search_text() {
  local pattern="$1"
  shift
  if command -v rg >/dev/null 2>&1; then
    rg "$pattern" "$@"
  else
    grep -R --line-number --binary-files=without-match "$pattern" "$@"
  fi
}

print_cloudflare_state() {
  echo "== Cloudflare tunnel state =="
  pgrep -af "cloudflared" || true

  local url=""
  for file in /tmp/cloudflared.log /tmp/cloudflared*.log "$HOME"/.cloudflared/*.log "$HOME"/.hermes/logs/*.log; do
    if [ -f "$file" ]; then
      url="$(grep -Eoh 'https://[a-zA-Z0-9-]+\\.trycloudflare\\.com' "$file" 2>/dev/null | tail -n 1 || true)"
      if [ -n "$url" ]; then
        echo "CLOUDFLARE_URL=$url"
        return 0
      fi
    fi
  done
  echo "CLOUDFLARE_URL=unknown"
}

require_command git
require_command node
require_command npm
require_command curl
require_command sudo

cd "$APP_DIR"

echo "== Current state =="
git status --short --branch || true
node -v
npm -v

node_major="$(node -p "Number(process.versions.node.split('.')[0])")"
if [ "$node_major" -lt 23 ]; then
  echo "Node >=23 is required; found $(node -v)" >&2
  exit 1
fi

sudo -n true

echo "== Preserve repo-only local changes =="
if [ -n "$(git status --porcelain)" ]; then
  git stash push -u -m "pre-command-center-deploy-$(date +%Y%m%d-%H%M%S)"
fi

echo "== Pull Hermes Command Center branch =="
git remote get-url "$REMOTE_NAME" >/dev/null 2>&1 || git remote add "$REMOTE_NAME" "$REMOTE_URL"
git remote set-url "$REMOTE_NAME" "$REMOTE_URL"
git fetch "$REMOTE_NAME" "$BRANCH"
git checkout -B "$BRANCH" "$REMOTE_NAME/$BRANCH"
git merge-base --is-ancestor "$MIN_REQUIRED_COMMIT" HEAD
echo "CHECKED_OUT_COMMIT=$(git rev-parse HEAD)"

echo "== Install and build =="
npm install
npm run build

echo "== Sanity check built UI =="
search_text "Hermes Command Center" dist/client dist/server
search_text "Checking Secure Session|Validating your private command center link|Secure Link Required" dist/client dist/server
if search_text "Enter your username and password|Private Command Center|Private dashboard" dist/client dist/server; then
  echo "Old login copy found in built assets" >&2
  exit 1
fi

echo "== Install global web UI package =="
sudo npm install -g "$APP_DIR"

echo "== Restart only hermes-web-ui =="
pgrep -af "hermes-web-ui|dist/server" || true
print_cloudflare_state
pkill -f "hermes-web-ui/dist/server" || true
pkill -f "hermes-web-ui start" || true
sleep 2
nohup hermes-web-ui start > "$LOG_FILE" 2>&1 &
sleep 6

echo "== Verify local services =="
curl -fsSI http://127.0.0.1:8648 | sed -n '1,12p'
curl -fsS http://127.0.0.1:8642/health || curl -fsS http://127.0.0.1:8642/

echo "== Process state =="
pgrep -af "hermes-web-ui|dist/server"
print_cloudflare_state
tail -100 "$LOG_FILE" || true

if [ -x scripts/verify-command-center-server.sh ]; then
  bash scripts/verify-command-center-server.sh
fi

echo "DEPLOY_OK commit=$(git rev-parse HEAD)"
