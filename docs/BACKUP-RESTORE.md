# Backups and restore

## What is backed up
The `backup` container runs every night at `BACKUP_HOUR` (default 02:00 IST) and writes to
`./backups`:

| File | Contents |
|---|---|
| `<stamp>-db.dump.gpg` | Full PostgreSQL dump: pages, databases, comments, users, settings |
| `<stamp>-uploads.tar.gz.gpg` | All uploaded files and images |
| `<stamp>.ok` | Checksums, written last. A backup is complete only if this exists |

Both files are encrypted with AES-256 using `BACKUP_PASSPHRASE`. Local copies are kept for
`BACKUP_KEEP_DAYS` days (default 14).

Also keep a copy of `.env` (or at least its secrets) in your password manager. It is not in the
backup on purpose, because it holds the passphrase.

## Off-site copy (free: Google Drive)
A backup on the same laptop does not survive a stolen or dead laptop. Copy it to Google Drive
(the Workspace account has storage):

```sh
docker compose run --rm backup rclone config     # create a remote named "gdrive" (type: drive)
```
Follow the prompts. On the "use auto config?" question answer `n` and complete the browser
step on any computer. Then set `RCLONE_REMOTE=gdrive:team-workspace-backups` in `.env` and run
`docker compose up -d backup`. Each nightly backup is then copied, already encrypted, to Drive.

## Run a backup now
```sh
docker compose exec backup /scripts/backup.sh
```

## Restore
**This replaces the current data.**
```sh
docker compose stop app
docker compose run --rm backup /scripts/restore.sh latest --yes     # or a specific <stamp>
docker compose start app
```
To restore onto a **new machine**: install Docker, copy the repo, put the same `.env`
(the same `BACKUP_PASSPHRASE`) and the backup files into `./backups`, run
`docker compose up -d postgres backup`, then run the restore commands above, then `docker compose up -d`.

## Restore drill (NOT YET RUN)
**Status 2026-10-12: the backup and restore scripts are written but have not been tested.**
Do not rely on backups until this drill passes. To run it, restore a backup from one deployment
into a completely fresh one (a separate compose project with new volumes, e.g.
`docker compose -p drill ...`). Then check that page content, database rows, uploaded files
and sign-in all work. Repeat the drill:
- after any infrastructure change,
- at least once a quarter,
- before relying on the system for anything you can't afford to lose.

A backup that has never been restored is not a backup.
