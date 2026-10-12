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

## Restore drill
**Last passed: 2026-10-12, on a Windows 11 laptop with Docker Desktop.** That covers the local
backups only. The off-site (rclone) copy has not been drilled yet. Repeat the drill on the real
deployment once it's set up.

| Step (2026-10-12) | Time | Result |
|---|---|---|
| Source stack `-p twdrill`: first admin, a page with content, a Tasks row, an uploaded file | — | seeded |
| `backup.sh` in the source stack | 22:02:11 → 22:02:13 (2 s) | 3 files, 28 KB |
| New stack `-p twrestore` (new empty volumes, same `.env` secrets): `up -d postgres backup` | 22:01:48 | empty |
| `restore.sh latest --yes` | 22:02:19 → 22:02:28 (9 s) | checksums OK |
| `up -d`, app healthy | 22:02:46 | migrations no-op |
| Checks on the restored stack | — | **all pass** |
| Restore again over the now-populated database (same-machine case) | 22:03 | **all pass** |

Checks run against the restored app through its API: the original admin can sign in (and a wrong
password is rejected); the page title and full document JSON are identical; the Tasks rows are
identical; the uploaded file downloads with the same SHA-256; full-text search finds the page.

To repeat it: restore a backup from one deployment into a completely fresh one (a separate
compose project with new volumes, e.g. `docker compose -p drill ...`) and run the same checks.
On Windows with Git Bash, set `MSYS_NO_PATHCONV=1` first, or Git Bash rewrites `/scripts/...`
into a Windows path. Repeat the drill:
- after any infrastructure change,
- at least once a quarter,
- before relying on the system for anything you can't afford to lose.

A backup that has never been restored is not a backup.
