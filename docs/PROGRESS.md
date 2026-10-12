# Build progress / handoff

Last updated: 2026-10-12 (second session). Read `docs/PLAN.md` (architecture) and `README.md`
(how to run) first.

## Decisions from the team (2026-10-12)
- **Free prototype**: laptop + Docker, public HTTPS via **Cloudflare Tunnel** on `uncanned.in`.
  Railway later if it works out and costs are nominal. (The brief suggested Caddy on a VPS. The
  tunnel replaces it for the prototype; `docs/DEPLOY.md` covers both.)
- Region preference India; must be reachable globally (the tunnel handles that).
- Email: shared **Google Workspace** mailbox via SMTP App Password (optional).
- **Migrate Notion data** via the Markdown & CSV export (importer built and tested).

## Status: functional prototype complete
Everything in the MVP scope is built and has automated tests:
- Auth (invite-only, reset, sessions, rate limits), teamspaces, audit log.
- **Roles: Owner, Admin, Member, Viewer** (added 2026-10-12, migration `0003_roles`):
  - **Owner**: exactly one per workspace, enforced by a unique index. Manages admins. Can't be
    removed or demoted; ownership is transferred instead, and the old owner becomes an admin.
  - **Admin**: members, viewers, invitations, teamspaces, settings, audit log, workspace export.
    Can't act on the owner or other admins. This closes a hole where any admin could create a
    password-reset link for another admin.
  - **Member**: creates and edits content.
  - **Viewer**: reads and searches only. `page_access()` caps viewers at "view", so even their
    own pages and explicit edit grants are read-only. No creating pages, editing, commenting or
    uploading.
  - Existing workspaces: the migration makes the creating admin (from the audit log) the owner.
- Sidebar tree with drag & drop, favorites, recents, private/workspace/teamspace/shared sections,
  templates, trash, archive.
- Block editor (all 18 block types, slash menu, toolbar, drag handles, mentions, uploads),
  autosave with conflict detection + local draft recovery, version history + restore, comments.
- Databases: table/board/list/calendar, filters/sorts/grouping, property editing, relations,
  rollups, formulas; built-in Projects/Tasks/Meetings with progress roll-up. Starter views and
  fields now match the brief: Projects "Upcoming deadlines"; Tasks "High priority", Notes and
  Created; Meetings "Follow-up date"; the meeting template has a "Discussion" section.
- **Starter company wiki** (new workspaces only): a "Company wiki" page with real, editable
  sub-pages (Company information, Team documentation, Standard operating procedures,
  Engineering, Marketing, Project documentation, Meeting notes). The last two embed the Projects
  and Meetings databases. Deleting the wiki page removes it all.
- Meetings: action items → tasks (idempotent), decisions, open action items.
- **Notion-style keyboard shortcuts** (`Ctrl+/` lists them all). Text formatting, turn-into
  `Ctrl+Alt+0–9`, duplicate `Ctrl+D`, move block `Ctrl+Shift+↑/↓`, tick a to-do `Ctrl+Enter`,
  link `Ctrl+K` on a selection, comments `Ctrl+Alt+M`, new page `Ctrl+Alt+N`, back/forward
  `Ctrl+[`/`]`, dark mode `Ctrl+Shift+L`. The editor's are in
  `web/src/components/editor/shortcuts.ts`; the app's are in `components/shell/app-shell.tsx`.
- Search (permission-filtered, highlighted snippets), Markdown/JSON/CSV/full export, Notion import.
- Docker deployment (app, Postgres, Cloudflare Tunnel, encrypted backups + rclone off-site).

## Test results (2026-10-12, second laptop, Windows 11)
- Unit + integration (real Postgres): **47 passed**. End-to-end (Playwright, production build):
  **11 passed** (10 desktop + 1 mobile). Production build and type check clean.
  **Lint clean** (0 errors). The first session's 14 lint errors, React-compiler rules,
  were fixed or annotated with a reason; autosave was restructured without behaviour changes.
- **Docker image build: passes.** The first clean build exposed bugs that only appear without a
  developer's local setup. All fixed:
  - `next build` crashed at "Collecting page data": the DB client connected when the module was
    imported, and there is no `DATABASE_URL` at build time. It now connects on first use.
  - The runner stage copied `web/public`, which git doesn't keep because it is empty.
  - Test setup assumed `workspace_test` / `workspace_e2e` already existed; now created if
    missing. Playwright also creates the e2e database before starting its web server.
- **Backup/restore drill: passed.** Restored into a fresh stack and over a populated one; sign-in,
  page content, rows, files and search all verified. Timings in `docs/BACKUP-RESTORE.md`.
  The off-site rclone copy is still untested.
- **Migration on real data: passed.** The drill database (created before roles existed) was
  upgraded by the new image: its admin became owner, and all drill checks still pass.

## Live deployment (2026-10-12)
- **https://notion.uncanned.in**: the Docker stack on the laptop at `C:\dev	eam-workspace`
  (`docker compose up -d`; the app is published on `127.0.0.1:3300`). Secrets are in `.env`,
  which is not committed. Keep `BACKUP_PASSPHRASE` in a password manager.
- Public route: the existing `uncanned-whatsapp` Cloudflare tunnel (Windows service `Cloudflared`,
  config `C:\dev\cloudflared-config\config.yml`), which also serves cutroom and whatsapp.
  Changing the config needs `Restart-Service Cloudflared` in an admin PowerShell.
- Nightly encrypted backups to `backups/` at 02:00. The off-site copy is not configured yet.
- Cloudflare's free plan limits uploads to 100 MB, so import larger Notion ZIPs from the laptop.

## Known limitations
- No real-time co-editing yet (by design for the first release). Simultaneous edits are detected
  and resolved through a dialog, and the other version is always kept in history. Presence avatars
  show who else has the page open.
- Bookmarks don't fetch page previews (avoids server-side URL fetching / SSRF).
- Images pasted into a different page keep the original page's access rules.
- Notion relations/people columns import as text.
- Database row-level sharing is not separate from the database's sharing.
- No in-app notifications (e.g. "you were mentioned") yet.
- Viewers can still export pages they can read (an export is a read). Restrict it if needed.
- Workspaces created before 2026-10-12 don't get the starter wiki; it is created only at setup.

## Next steps
1. ~~Deploy~~ done: live at notion.uncanned.in. Invite 2–3 people from Settings → Members.
2. Import one Notion teamspace and review it with its owners.
3. Turn on the off-site backup (rclone → Google Drive) and repeat the restore drill there.
4. Phase D candidates: real-time co-editing (Yjs + Hocuspocus, MIT), mention notifications,
   per-row sharing, bookmark previews with an SSRF-safe fetcher.
