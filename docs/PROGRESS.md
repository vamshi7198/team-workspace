# Build progress / handoff

Last updated: 2026-10-12. Read `docs/PLAN.md` (architecture) and `README.md` (how to run) first.

## Decisions from the team (2026-10-12)
- **Free prototype**: laptop + Docker, public HTTPS via **Cloudflare Tunnel** on `uncanned.in`.
  Railway later if it works out and costs are nominal.
- Region preference India; must be reachable globally (the tunnel handles that).
- Email: shared **Google Workspace** mailbox via SMTP App Password (optional).
- **Migrate Notion data** via the Markdown & CSV export (importer built and tested).

## Status: functional prototype complete
Everything in the MVP scope is built and has automated tests:
- Auth (invite-only, reset, sessions, rate limits), members/roles/teamspaces, audit log.
- Sidebar tree with drag & drop, favorites, recents, private/workspace/teamspace/shared sections,
  templates, trash, archive.
- Block editor (all 18 block types, slash menu, toolbar, drag handles, mentions, uploads),
  autosave with conflict detection + local draft recovery, version history + restore, comments.
- Databases: table/board/list/calendar, filters/sorts/grouping, property editing, relations,
  rollups, formulas; built-in Projects/Tasks/Meetings with progress roll-up.
- Meetings: action items → tasks (idempotent), decisions, open action items.
- Search (permission-filtered, highlighted snippets), Markdown/JSON/CSV/full export, Notion import.
- Docker deployment (app, Postgres, Cloudflare Tunnel, encrypted backups + rclone off-site).

## Test results (2026-10-12)
- Unit: 22 passed. Integration (real Postgres): 17 passed. End-to-end (Playwright, production
  build): 10 desktop + 1 mobile passed.
- **Not yet verified:** the full Docker image build (`web/Dockerfile`) and the backup/restore drill.
  The backup image built fine. The app image got through dependency install, compile and type
  check, then was stopped during "Collecting page data" when work moved to another laptop. It was
  very slow (about 50 min) because the Docker VM was shared with other projects.
  **First task when resuming:** `docker compose -p twdrill --env-file .env.drill up -d --build`
  (make your own `.env.drill` from `.env.example`). Then run the drill in `docs/BACKUP-RESTORE.md`.

## Known limitations
- No real-time co-editing yet (by design for the first release). Simultaneous edits are detected
  and resolved through a dialog, and the other version is always kept in history. Presence avatars
  show who else has the page open.
- Bookmarks don't fetch page previews (avoids server-side URL fetching / SSRF).
- Images pasted into a different page keep the original page's access rules.
- Notion relations/people columns import as text.
- Database row-level sharing is not separate from the database's sharing.
- No in-app notifications (e.g. "you were mentioned") yet.

## Next steps
1. Deploy on the chosen laptop following `docs/DEPLOY.md`, create the tunnel, invite 2–3 people.
2. Import one Notion teamspace and review it with its owners.
3. Turn on the off-site backup (rclone → Google Drive) and repeat the restore drill there.
4. Phase D candidates: real-time co-editing (Yjs + Hocuspocus, MIT), mention notifications,
   per-row sharing, bookmark previews with an SSRF-safe fetcher.
