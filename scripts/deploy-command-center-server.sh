#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/home/ubuntu/.hermes/hermes-web-ui}"
REMOTE_NAME="${REMOTE_NAME:-deploy}"
REMOTE_URL="${REMOTE_URL:-https://github.com/leadrescuepro/hermes-web-ui.git}"
BRANCH="${BRANCH:-chemicon-redesign}"
MIN_REQUIRED_COMMIT="${MIN_REQUIRED_COMMIT:-87d895bdb4d6a2706b1d1108851a3ef4b1b14d5e}"
LOG_FILE="${LOG_FILE:-/tmp/hermes-web-ui.log}"

search_text() {
  local pattern="$1"
  shift
  if command -v rg >/dev/null 2>&1; then
    rg "$pattern" "$@"
  else
    grep -R --line-number --binary-files=without-match "$pattern" "$@"
  fi
}

cd "$APP_DIR"

echo "== Current state =="
git status --short --branch || true
node -v
npm -v

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

echo "== Install and build =="
npm install
npm run build

echo "== Sanity check built UI =="
search_text "Hermes Command Center" dist/client dist/server
if search_text "Enter your username and password|Private Command Center" dist/client dist/server; then
  echo "Old login copy found in built assets" >&2
  exit 1
fi

echo "== Install global web UI package =="
sudo npm install -g "$APP_DIR"

echo "== Restart only hermes-web-ui =="
pgrep -af "hermes-web-ui|dist/server" || true
pkill -f "hermes-web-ui/dist/server" || true
pkill -f "hermes-web-ui start" || true
sleep 2
nohup hermes-web-ui start > "$LOG_FILE" 2>&1 &
sleep 6

echo "== Verify local services =="
curl -fsS http://127.0.0.1:8648 >/dev/null
curl -fsS http://127.0.0.1:8642/health || curl -fsS http://127.0.0.1:8642/

echo "== Process state =="
pgrep -af "hermes-web-ui|dist/server"
pgrep -af "cloudflared" || true
tail -100 "$LOG_FILE" || true

echo "DEPLOY_OK commit=$(git rev-parse HEAD)"
