# Team Workspace

A self-hosted workspace for docs, wikis, projects, tasks and meeting notes: a Notion
replacement for a small team that owns its data. Free and open-source software only. No AI or
paid APIs are needed to run it.

- **Docs**: block editor with slash commands, headings, to-dos, toggles, callouts, code,
  tables, images, files, bookmarks, @-mentions, sub-pages and embedded databases. Autosaves, and
  never silently overwrites someone else's edit.
- **Databases**: table, board, list and calendar views. Filters, sorts, grouping, relations,
  rollups and safe formulas. Built-in **Projects**, **Tasks** and **Meetings** come linked together.
- **Meetings**: action items become tasks with one click, without duplicates, and decisions are collected.
- **Knowledge**: nested pages, favorites, recents, backlinks, templates, trash, archive, version history.
- **Search** across pages, rows and comments, filtered by permissions.
- **Access**: Owner / Admin / Member / Viewer roles, private pages, workspace pages, teamspaces
  and per-person sharing, all enforced on the server.
- **Ownership**: Markdown/JSON/CSV export, full workspace export, Notion import, encrypted backups.

## Run it
- Deploy (laptop + Cloudflare Tunnel, Railway, or VPS): [docs/DEPLOY.md](docs/DEPLOY.md)
- Backups and restore: [docs/BACKUP-RESTORE.md](docs/BACKUP-RESTORE.md)
- Moving from Notion: [docs/NOTION-MIGRATION.md](docs/NOTION-MIGRATION.md)
- Formula reference: [docs/FORMULAS.md](docs/FORMULAS.md)
- Architecture, data model and costs: [docs/PLAN.md](docs/PLAN.md)

## Develop
Requires Node 24 and Docker.
```sh
docker compose -f docker-compose.dev.yml up -d        # Postgres on 127.0.0.1:5434
cd web
cp .env.example .env.local                            # set BETTER_AUTH_SECRET
npm install
npm run db:migrate
npm run setup -- --workspace "Dev" --email dev@example.com --name "Dev"
npm run dev                                           # http://localhost:3000
```

Tests (need the dev Postgres running):
```sh
npm run test:unit           # formula engine, filters/sorts, document and Markdown conversion
npm run test:integration    # services against a real database (permissions, conflicts, imports…)
npm run build && npm run test:e2e    # browser tests (Playwright) against a production build
```

## Code map
```
web/src/app/              routes (UI pages, /api/[...path] and /api/auth/[...all])
web/src/server/api/       the API route table: every endpoint and its input validation
web/src/server/services/  business logic; every call checks permissions first
web/src/server/db/        Drizzle schema; SQL migrations live in web/drizzle/
web/src/lib/              code shared by browser and server (editor schema, doc helpers, db engine)
web/src/components/       UI (shell, editor, database views, page screens)
backup/                   nightly encrypted backup + restore container
```
Permissions are computed in one place, the `page_access()` SQL function
(`web/drizzle/0002_access_function.sql`), used by every service and by search.
