# Team Workspace — Phase A Plan

Self-hosted Notion replacement for a 5–10 person team (headroom to 25–50).
Status: **Phase A (planning) — awaiting review before Phase B.**
Date: 2026-10-12

---

## 1. Architecture

```
                 Internet (HTTPS only, 80→443 redirect)
                              │
                ┌─────────────▼──────────────┐
  VPS (1 box)   │ caddy  (auto TLS, headers) │  only container with public ports
  Docker        └─────────────┬──────────────┘
  Compose                     │ internal network
                ┌─────────────▼──────────────────────────────────┐
                │ app  (Next.js 16 standalone, Node 24)           │
                │  ├ UI: App Router, React, Tailwind, shadcn/ui   │
                │  ├ route handlers / server actions (thin)       │
                │  ├ service layer  ← all business logic          │
                │  │   auth · workspaces · pages · blocks · dbs   │
                │  │   meetings · search · comments · files       │
                │  │   versions · admin · export                  │
                │  ├ permissions (one shared `authorize()` layer) │
                │  ├ in-process scheduler (trash purge, pruning)  │
                │  └ storage interface → LocalDisk | S3 (later)   │
                └──────┬──────────────────────────┬──────────────┘
                       │                          │
           ┌───────────▼──────────┐   ┌───────────▼──────────┐
           │ postgres 17          │   │ /data/uploads volume │
           │ (no published port)  │   │ (outside container)  │
           └───────────┬──────────┘   └───────────┬──────────┘
                       │  pg_dump -Fc        tar  │
                ┌──────▼──────────────────────────▼──────┐
                │ backup (restic + cron, nightly)        │──► encrypted, off-server
                └────────────────────────────────────────┘    (Backblaze B2 / any S3)

  Optional, Phase D only:  hocuspocus (Yjs) container behind the same Caddy.
  Optional, any phase:     SMTP relay (password reset / invites). If absent,
                           admins copy one-time links from the admin screen.
```

No Redis, no queue, no search cluster, no microservices. One app process, one database.

## 2. Key technical decisions

| Area | Choice | Why |
|---|---|---|
| Framework | Next.js 16 + TypeScript (App Router) | Requested; one deployable for UI + API |
| ORM / migrations | **Drizzle** (generated SQL migrations, committed and reviewed) | SQL-first: tsvector, recursive CTEs and JSONB queries stay readable; no engine binary |
| Auth | **Better Auth** (MIT), email+password, DB sessions, admin plugin | Self-hosted library, sessions revocable in DB, built-in rate limiting. Public sign-up **disabled**; our own small `invitations` table (hashed token, role, expiry) instead of a third-party invite plugin |
| Editor | **Tiptap 3** core + MIT extensions (drag-handle, unique-id, details, table, code-block-lowlight) | All verified MIT on npm (v3.31.4). No `@tiptap-pro` packages |
| Doc storage | ProseMirror JSON in `page_content.doc` (JSONB) + extracted plain text | Structured blocks; every block carries a stable `id` (UniqueID) |
| Databases | Rows **are pages** (`pages.database_id`, `pages.props` JSONB) | "Open record as page", comments, search, permissions and history all come for free |
| Relations | `relation_links` table (FK both ends) | Integrity + cheap backlinks, not IDs buried in JSON |
| Formula | Own small parser + evaluator (pure TS, shared client/server), no `eval` | Documented whitelist of operators/functions |
| Search | Postgres FTS (`tsvector` + GIN, `websearch_to_tsquery`, `ts_headline`) + `pg_trgm` on titles | Enough for tens of thousands of pages |
| Conflicts | Optimistic concurrency: `version` int, save sends `baseVersion`, 409 on mismatch | Never silently overwrites; conflict dialog |
| Files | `Storage` interface; local volume first; served only via authenticated `/api/files/:id` | Random IDs, permission check per request |
| Backups | restic (BSD-2) → B2/S3, client-side encrypted | Off-server, deduplicated, versioned |
| Logging | pino JSON → Docker log driver (size-rotated) | No content bodies in logs |
| Tests | Vitest (unit + integration against a real Postgres), Playwright (E2E) | |

## 3. Data model (core tables)

```
users(id, email UNIQUE, name, image, role_global?, created_at, banned)      ← Better Auth
sessions / accounts / verifications                                          ← Better Auth
workspaces(id, name, icon)
workspace_members(workspace_id, user_id, role ENUM admin|member)  PK(ws,user)
invitations(id, workspace_id, email, role, token_hash, expires_at, accepted_at, invited_by)
teamspaces(id, workspace_id, name, icon)  teamspace_members(teamspace_id, user_id)

pages(
  id uuid, workspace_id, parent_id → pages NULL, teamspace_id NULL,
  owner_id, visibility ENUM private|teamspace|workspace,
  title, icon, cover_file_id, sort_key (fractional index text),
  database_id → databases NULL,      -- set ⇒ this page is a database row
  props JSONB,                       -- row property values keyed by property id
  is_template bool, archived_at, deleted_at (trash), created_by, updated_by, timestamps,
  title_tsv tsvector GENERATED
)  idx: (workspace_id,parent_id,sort_key), (database_id), GIN(props), GIN(title_tsv), trgm(title)

page_content(page_id PK, doc JSONB, text, version int, updated_by, updated_at,
             text_tsv tsvector GENERATED)  GIN(text_tsv)
page_versions(id, page_id, doc, title, version, created_by, created_at, reason)
page_grants(page_id, user_id, level ENUM view|comment|edit|full)   -- explicit sharing
favorites(user_id, page_id)   page_visits(user_id, page_id, visited_at)   -- recents
page_links(from_page_id, to_page_id, block_id)          -- mentions → backlinks

databases(id, workspace_id, page_id (host page), name, system_key NULL UNIQUE per ws
          -- 'projects' | 'tasks' | 'meetings')
db_properties(id, database_id, name, type ENUM title|text|number|status|select|
          multi_select|date|checkbox|url|email|person|created_time|edited_time|
          relation|formula|rollup, config JSONB (options, colours, target db,
          expression…), position)
db_views(id, database_id, name, type ENUM table|board|calendar|list, config JSONB
          (filters, sorts, group_by, hidden/ordered props, column widths), position)
relation_links(property_id, from_page_id, to_page_id)  PK(all three)

action_item_tasks(meeting_page_id, block_id UNIQUE, task_page_id)   -- idempotent conversion
comments(id, page_id, block_id NULL, parent_id NULL, author_id, body JSONB, text,
         resolved_at, timestamps, text_tsv GENERATED)
files(id uuid, workspace_id, page_id, storage_key, original_name, mime, size,
      sha256, uploaded_by, created_at)
activity(id, workspace_id, page_id NULL, actor_id, action, meta JSONB, created_at)
audit_log(id, workspace_id, actor_id, action, target, meta JSONB, ip, created_at)
```

Projects / Tasks / Meetings are **ordinary databases** created with their schemas (properties
+ default views) when a workspace is bootstrapped. No sample rows in production; a separate
`seed:dev` script creates demo content for development only.

- Project **Progress** = rollup `percent(Related tasks where Status = Done)` computed in SQL
  from real task rows.
- **Action items** = to-do blocks inside a meeting's Action Items section. "Convert to task"
  inserts into `action_item_tasks` with `UNIQUE(block_id)`, so repeating it returns the
  existing task. The task keeps a relation back to the meeting.

### Permission model (enforced in `lib/permissions`, used by every service and by search SQL)
1. Must be a workspace member (admin or member).
2. Effective page access = the strongest of:
   - owner → full
   - `visibility=workspace` → edit for members
   - `visibility=teamspace` → edit for teamspace members
   - explicit `page_grants`
   - inherited from the nearest ancestor (recursive CTE) unless the page sets its own visibility
   - `private` pages: owner + explicit grants only (admins included only if granted)
3. Database rows inherit from their database's host page.
4. Files, comments, backlinks, embeds, exports and search results go through the same check.
   Hiding UI is never the control.

## 4. Dependency and licensing review (verified on npm, 2026-10-12)

| Package | Version | License | Note |
|---|---|---|---|
| next | 16.4.0 | MIT | |
| @tiptap/react + core extensions | 3.31.4 | MIT | |
| @tiptap/extension-drag-handle-react, -unique-id, -details, -table | 3.31.4 | MIT | Formerly Pro, now MIT on public npm |
| lowlight | 3.3.0 | MIT | Code highlighting |
| better-auth | 1.7.7 | MIT | |
| drizzle-orm / drizzle-kit | 0.45.4 | Apache-2.0 | |
| zod | 4.6.6 | MIT | Validation at every boundary |
| lucide-react | 1.55.0 | ISC | |
| shadcn/ui (copied source) + Radix | — | MIT | |
| pino | 10.4.0 | MIT | |
| vitest / @playwright/test | 5.0.4 / 1.64.0 | MIT / Apache-2.0 | dev only |
| @hocuspocus/server, yjs | 4.7.0 / 13.6.33 | MIT | Phase D, optional |
| PostgreSQL 17 | — | PostgreSQL License | |
| Caddy 2 | — | Apache-2.0 | |
| restic | — | BSD-2-Clause | |

Not used: `@tiptap-pro/*`, Tiptap Cloud, any paid auth, any AI SDK. All licenses allow
commercial internal use. `license-checker` will run in CI to block GPL/AGPL/unknown additions.

## 5. Implementation plan (each milestone ends with tests + a status report)

| Milestone | Scope | Exit check |
|---|---|---|
| **B1 Foundation** | Repo, Docker Compose dev Postgres, Drizzle schema + migrations, Better Auth (login, logout, sessions, reset, invites, admin bootstrap CLI), rate limits, audit log, CI scripts | Sign-in/invite/remove E2E green |
| **B2 Shell + pages** | Sidebar (tree, favorites, recents, private/shared/teamspaces, trash), dnd tree, create/rename/duplicate/move/archive/delete/restore, breadcrumbs, permissions layer | Permission integration tests (incl. negative cases) |
| **B3 Editor** | Tiptap with all 18 block types, slash menu, bubble toolbar, drag handles, mentions, backlinks, autosave states, optimistic concurrency + conflict dialog, Markdown export | Reload/restart persistence E2E, 409 conflict test, large-doc perf check |
| **B4 Databases** | Property engine, formula/rollup evaluator, table + board views, sort/filter/group in SQL, inline edit, saved views, record pages; Projects/Tasks schemas, My tasks / Overdue / Due soon / Completed views | Filter/sort tests on real rows, dnd status change E2E |
| **B5 Meetings + search** | Meetings DB + templates, action item → task (idempotent), Home page, global search (⌘K) with snippets, highlighting, permission filtering | Idempotency test, search-respects-permissions test |
| **B6 Export + backup v1** | JSON/Markdown/CSV export, full workspace zip, admin export screen | Export round-trip test |
| **C Reliability** | Version history + restore, attachments + image upload hardening, relations UI, Markdown import, CSP/headers, restic backups + **verified restore on a clean machine** | Restore drill documented with timestamps |
| **D Polish** | Comments + @mentions, activity feed, calendar + list views, shortcuts, mobile pass, *evaluate* Yjs/Hocuspocus behind a flag | Concurrency/reconnect tests before enabling |
| **E Deploy** | Prod Compose, `.env.example`, deploy/upgrade/rollback/restore runbooks, monitoring guide | Fresh-VPS deploy from docs |

Templates shipped (as template pages, not data): Meeting notes, Project brief, Weekly status,
SOP, PRD, Decision log, Retrospective, Team onboarding.

## 6. Deployment design

- One Ubuntu 24.04 VPS, Docker Compose. Services: `caddy`, `app`, `postgres`, `backup`.
- Only 22/80/443 open (ufw + provider firewall). SSH key-only, no root login, unattended-upgrades.
- Postgres on the internal Docker network only. No `ports:` mapping.
- Secrets live in `.env` on the server (chmod 600), never in git. `.env.example` is documented.
- Volumes: `pgdata`, `uploads`, `caddy_data`. Host paths are documented for backup.
- Migrations: `drizzle-kit migrate` runs as a one-shot container **after** an automatic
  pre-migration `pg_dump`. Destructive migrations need an explicit `--confirm-destructive` flag.
- Upgrades: pull a tagged image, run backup, migrate, restart. Rollback: previous image tag +
  restore the pre-migration dump.
- Backups: nightly `pg_dump -Fc` + uploads + `.env`/Caddyfile, encrypted with restic to B2.
  Retention 7 daily / 4 weekly / 6 monthly. A weekly `restic check`. The restore script is
  tested on a clean VM before go-live.
- Monitoring: `/api/health` (DB ping), Docker healthchecks, a free external uptime ping
  (optional, not relied on), disk-usage alert via a cron email, and a backup-age check.

## 7. Monthly cost estimate (approximate: ₹100 ≈ €1, ₹88 ≈ $1; confirm at checkout)

**Current decision (2026-10-12): free prototype.** It runs on a laptop with Docker, gets a public
address through a free Cloudflare Tunnel on `uncanned.in`, sends email through the existing
Google Workspace mailbox, and keeps encrypted backups with an off-site copy on Google Drive.
Recurring cost: **₹0** (the domain is already paid for). The trade-off is that the app is offline
whenever the laptop sleeps or is shut down. Next step if it works out: Railway (≈ $5–10/month,
usage-based) or a VPS as below. See `docs/DEPLOY.md`.

Free software is not free hosting: every line below is a real recurring cost.

| Item | Minimum | Recommended |
|---|---|---|
| VPS | Hetzner CX23, 2 vCPU / 4 GB / 40 GB, EU: ~€4–5.5 → **₹400–550** | Hetzner CX33-class, 4 vCPU / 8 GB / 80 GB, EU: ~€7–9 → **₹700–900** |
| Provider snapshots (+20%) | ₹80–110 | ₹140–180 |
| Off-server backup (B2, <50 GB, $6.95/TB) | ~₹30 | ~₹60 |
| Domain (.in / .com, yearly ÷ 12) | ₹50–90 | ₹50–90 |
| Email (SMTP: existing Google Workspace or a free transactional tier; optional) | ₹0 | ₹0 |
| Monitoring (free uptime ping + self checks) | ₹0 | ₹0 |
| Data transfer (20 TB EU allowance included) | ₹0 | ₹0 |
| Licenses | ₹0 | ₹0 |
| **Total** | **≈ ₹560–780** | **≈ ₹950–1,230** |

Trade-off: EU servers add ~130–160 ms latency from India. Editing is unaffected because
autosave is asynchronous, but page loads feel slightly slower. An India region
(DigitalOcean Bangalore, 4 GB ≈ $24) brings the recommended option to roughly
**₹2,300–2,600**, around the top of the budget. Hetzner Singapore is ~40–67% above EU prices.
Pricing changed in 2026 and sources disagree, so verify on the provider page before buying.

### Full cost picture: cash vs. effort
The table above covers only cash paid to vendors. The other costs are people's time, and
they are estimates, not guarantees.

| Category | Prototype (laptop + tunnel) | VPS (recommended) |
|---|---|---|
| **1. Infrastructure cash, per month** | ₹0 (domain already paid for; electricity not counted) | ≈ ₹950–1,230 (EU) or ≈ ₹2,300–2,600 (India region), from the table above |
| **2. One-time development effort** | Already spent building the prototype. To go live: ≈ 1–2 days (deploy, tunnel, invite the team, import one Notion teamspace, run the restore drill on the real machine) | Same, plus ≈ ½ day to harden a fresh VPS (SSH keys, firewall, unattended upgrades) |
| **3. Ongoing maintenance, per month** | ≈ 2–4 hours: apply dependency and security updates (rebuild + redeploy), check that nightly backups ran, answer user questions. Plus ≈ 1 hour each quarter for the restore drill | Same, plus OS patch reboots. Budget the same 2–4 hours |
| **4. Optional services** | Cloudflare Access gate (free ≤ 50 users); Google Drive off-site copy (included in Workspace storage) | Provider snapshots (+20% of the VPS price); Backblaze B2 instead of Drive (≈ ₹30–60); paid uptime monitoring (not needed; free pings suffice) |

Not included anywhere: AI APIs (none are used), paid editor extensions (none are used), and
Notion itself. Cancelling the Notion plan is the saving that pays for all of the above.

Developer time is the real cost of owning the tool. A Claude Code session can make most changes,
but someone on the team must review them, run the tests and deploy. Budget that time as
maintenance, not as free.

## 8. Main risks

1. **Scope.** This is a multi-week build. Mitigation: milestone gates; nothing is called done until it is tested.
2. **Permission leaks** through search, backlinks, embeds, mentions, exports or file URLs. Mitigation: a single `authorize()` path plus negative-case integration tests for every surface.
3. **Data loss** from autosave bugs or conflicts. Mitigation: versioned saves, 409 on stale writes, local unsaved buffer kept until the server ACKs, periodic snapshots.
4. **Unverified backups.** Mitigation: a scripted restore drill. Backups are not claimed to work until one passes.
5. **Bookmark previews** fetch URLs server-side, which is an SSRF risk. Mitigation: block private/loopback ranges, enforce timeouts and size caps, or skip previews entirely.
6. **Uploaded content XSS.** Mitigation: MIME sniffing, an allowlist, `Content-Disposition: attachment` for non-images, SVG never inline, `nosniff`, strict CSP.
7. **Real-time collaboration** is the most fragile feature. Mitigation: deferred to Phase D behind a flag, and not advertised until concurrency tests pass.
8. **Single VPS** is a single point of failure. Accepted at this size. RTO is about 1 hour via restore onto a new VPS; RPO is 24 hours (can drop to hourly dumps cheaply).
9. **Email deliverability** for resets and invites. Mitigation: the app works without SMTP because admins can copy one-time links.

## 9. Decisions needed from the team before/while building

1. **Server region:** EU (cheapest) or India (lower latency, about 2× cost)?
2. **Email:** Is there an existing SMTP account (e.g. Google Workspace) to send resets and invites?
3. **Domain/subdomain** to deploy on (e.g. `wiki.company.in`)?
4. **Notion migration:** should we import your existing Notion export (Markdown + CSV zip)? It's feasible in Phase C.
