#!/usr/bin/env bash
set -euo pipefail

REMOTE="${HERMES_BACKUP_REMOTE:-ubuntu@43.156.47.222}"
REMOTE_DIR="${HERMES_BACKUP_REMOTE_DIR:-/home/ubuntu/.hermes-web-ui/backups/}"
LOCAL_DIR="${HERMES_BACKUP_LOCAL_DIR:-$HOME/Hermes_Backups}"
SSH_KEY="${HERMES_BACKUP_SSH_KEY:-$HOME/.ssh/hermes_command_center_ed25519}"
LOG_FILE="$LOCAL_DIR/pull-backup.log"

mkdir -p "$LOCAL_DIR"

RSYNC_SSH=(ssh -o IdentitiesOnly=yes)
if [[ -f "$SSH_KEY" ]]; then
  RSYNC_SSH+=( -i "$SSH_KEY" )
fi

{
  echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Starting Hermes backup pull"
  echo "Remote: $REMOTE:$REMOTE_DIR"
  echo "Local: $LOCAL_DIR"
} >> "$LOG_FILE"

rsync -avz --partial --include='*.zip' --include='*.sha256' --exclude='*' \
  -e "${RSYNC_SSH[*]}" \
  "$REMOTE:$REMOTE_DIR" "$LOCAL_DIR/" >> "$LOG_FILE" 2>&1

if command -v shasum >/dev/null 2>&1; then
  find "$LOCAL_DIR" -maxdepth 1 -name '*.sha256' -print0 | while IFS= read -r -d '' checksum_file; do
    (
      cd "$LOCAL_DIR"
      shasum -a 256 -c "$(basename "$checksum_file")"
    ) >> "$LOG_FILE" 2>&1 || {
      echo "Checksum verification failed for $checksum_file" | tee -a "$LOG_FILE"
      exit 1
    }
  done
fi

echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Hermes backup pull complete" >> "$LOG_FILE"
echo "Hermes backups copied to $LOCAL_DIR"
