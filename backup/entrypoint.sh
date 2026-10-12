#!/bin/sh
# Runs one backup at BACKUP_HOUR every day (container time zone = TZ).
# Any arguments are executed instead (e.g. "backup.sh" or "restore.sh <stamp>").
set -e
if [ "$#" -gt 0 ]; then exec "$@"; fi

echo "Backup service started. Daily backup at ${BACKUP_HOUR:-2}:00 ${TZ:-UTC}."
last=""
while true; do
  hour=$(date +%H | sed 's/^0//')
  today=$(date +%F)
  if [ "${hour:-0}" -eq "${BACKUP_HOUR:-2}" ] && [ "$last" != "$today" ]; then
    if /scripts/backup.sh; then last="$today"; else echo "Backup FAILED at $(date)"; fi
  fi
  sleep 300
done
