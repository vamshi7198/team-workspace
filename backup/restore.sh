#!/bin/sh
# Restores a backup made by backup.sh into the CURRENT database and uploads volume.
#   docker compose stop app
#   docker compose run --rm backup restore.sh <stamp> --yes
#   docker compose start app
# <stamp> is the file prefix, e.g. 20261012-020000. "latest" picks the newest complete backup.
# This REPLACES the current data. Take a fresh backup first if the current data matters.
set -eu
: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE is required}"
dir=/backups
stamp="${1:-}"
confirm="${2:-}"
if [ "$stamp" = "latest" ]; then
  stamp=$(ls "$dir"/*.ok 2>/dev/null | sort | tail -1 | xargs -r basename | sed 's/\.ok$//')
fi
if [ -z "$stamp" ] || [ ! -f "$dir/$stamp.ok" ]; then
  echo "Usage: restore.sh <stamp|latest> --yes"; echo "Complete backups:"; ls "$dir"/*.ok 2>/dev/null | xargs -r -n1 basename | sed 's/\.ok$//'
  exit 1
fi
if [ "$confirm" != "--yes" ]; then echo "Refusing to overwrite data without --yes"; exit 1; fi

echo "Verifying checksums for $stamp"
(cd "$dir" && sed "s#$dir/##" "$stamp.ok" | sha256sum -c -)

dec() { gpg --batch --quiet --decrypt --passphrase-fd 3 "$1" 3<<EOF
$BACKUP_PASSPHRASE
EOF
}

echo "Restoring database"
dec "$dir/$stamp-db.dump.gpg" > /tmp/restore.dump
psql -v ON_ERROR_STOP=1 -q -c "drop schema if exists drizzle cascade; drop schema public cascade; create schema public;"
pg_restore --no-owner --no-privileges --exit-on-error -d "$PGDATABASE" /tmp/restore.dump
rm -f /tmp/restore.dump

echo "Restoring uploaded files"
rm -rf /data/uploads/*
dec "$dir/$stamp-uploads.tar.gz.gpg" | tar -C /data -xzf -

echo "Restore of $stamp complete. Start the app: docker compose start app"
