#!/bin/sh
# Encrypted backup of the database and uploaded files.
#   /backups/<stamp>-db.dump.gpg       pg_dump custom format, AES256 (BACKUP_PASSPHRASE)
#   /backups/<stamp>-uploads.tar.gz.gpg
#   /backups/<stamp>.ok                written last; a backup without it is incomplete
# Optionally copies everything to RCLONE_REMOTE (e.g. Google Drive) and prunes old files.
set -eu
: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE is required}"
stamp=$(date +%Y%m%d-%H%M%S)
dir=/backups
mkdir -p "$dir"
enc() { gpg --batch --yes --quiet --symmetric --cipher-algo AES256 --passphrase-fd 3 3<<EOF
$BACKUP_PASSPHRASE
EOF
}

echo "[$stamp] dumping database"
pg_dump --format=custom --no-owner --no-privileges | enc > "$dir/$stamp-db.dump.gpg.part"
mv "$dir/$stamp-db.dump.gpg.part" "$dir/$stamp-db.dump.gpg"

echo "[$stamp] archiving uploads"
tar -C /data -czf - uploads | enc > "$dir/$stamp-uploads.tar.gz.gpg.part"
mv "$dir/$stamp-uploads.tar.gz.gpg.part" "$dir/$stamp-uploads.tar.gz.gpg"

sha256sum "$dir/$stamp-db.dump.gpg" "$dir/$stamp-uploads.tar.gz.gpg" > "$dir/$stamp.ok"
echo "[$stamp] backup complete: $(du -ch "$dir/$stamp"-* | tail -1 | cut -f1)"

# Keep BACKUP_KEEP_DAYS days locally.
find "$dir" -type f -mtime +"${BACKUP_KEEP_DAYS:-14}" -name '20*' -delete

if [ -n "${RCLONE_REMOTE:-}" ]; then
  echo "[$stamp] copying to $RCLONE_REMOTE"
  rclone copy "$dir" "$RCLONE_REMOTE" --include "$stamp*"
  rclone delete "$RCLONE_REMOTE" --min-age "${BACKUP_KEEP_DAYS:-14}d" || true
  echo "[$stamp] off-site copy complete"
fi
