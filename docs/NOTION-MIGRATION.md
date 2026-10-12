# Moving from Notion

## Export from Notion
1. Notion → **Settings** → **Workspace** → **General** → *Export all workspace content*. To move one
   section only, open that page and use **⋯ → Export**.
2. Format: **Markdown & CSV**. Include sub-pages and "Create folders for sub-pages". Include files and images.
3. Notion emails a download link. Large workspaces arrive as several `Part-N.zip` files inside one ZIP.
   Upload that outer ZIP as-is.

## Import here
Sidebar → **Import** → choose the ZIP → Import. Everything lands under one new private page
(e.g. "Notion import"), so nothing existing is touched. Then move sections where they belong
(⋯ → Move to, or drag in the sidebar) and set sharing.

## What comes across
| Notion | Here |
|---|---|
| Pages and nested sub-pages | Pages with the same hierarchy |
| Headings, lists, to-dos, quotes, code, tables, dividers, links, bold/italic/strike/code | Same blocks |
| Images and attached files | Uploaded and linked (allowed types: images, PDF, Office, text, ZIP) |
| Links between pages | Rewritten to point at the imported pages |
| Databases (CSV) | Real databases. Columns are detected as text, number, date, checkbox, select, multi-select, status, URL or email |
| Database row pages | Row pages, with their body content |

## Known gaps (fix by hand after import)
- **Relations and people columns** come across as text, because Notion's CSV holds names, not IDs.
  Recreate key relations (e.g. Tasks → Project) with a Relation property and re-link.
- **Comments, page permissions, page history** are not in Notion's export.
- **Callouts and toggles** arrive as quotes and plain blocks.
- **Synced blocks and linked database views** come across as their content or a link.
- Notion's database **views** (filters, boards) aren't exported. Recreate them with the view tabs.

## Suggested migration plan
1. Import a single teamspace first and check it with its owners.
2. Import the rest. Move everything into Workspace or teamspaces, and set sharing.
3. Rebuild the Projects/Tasks/Meetings workflow in the built-in databases (they already have the
   relations, views and progress roll-up). Copy only active projects and tasks, not years of history.
4. Freeze Notion (read-only) for two weeks, then cancel the subscription.
