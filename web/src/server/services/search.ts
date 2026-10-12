import { sql } from "drizzle-orm";
import { db } from "../db";
import { requireMember } from "./permissions";

export type SearchResult = {
  type: "page" | "comment";
  id: string;
  pageId: string;
  title: string;
  icon: string | null;
  kind: string;
  context: string | null;
  snippet: string | null;
  archived: boolean;
  updatedAt: string;
};

// Snippet highlight markers. The client escapes the text and turns these into <mark>.
export const HL_START = "\u0002";
export const HL_END = "\u0003";

/** Builds a prefix tsquery ("lau:* & pla:*") from user input; only letters and digits survive. */
export function toPrefixQuery(q: string): string | null {
  const tokens = q
    .toLowerCase()
    .normalize("NFKC")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .slice(0, 8);
  if (!tokens.length) return null;
  return tokens.map((t) => `${t}:*`).join(" & ");
}

/**
 * Full-text search over page titles, row properties, page content and comments.
 * Every result is filtered through page_access(), so search never reveals pages the
 * user cannot open.
 */
export async function search(userId: string, workspaceId: string, q: string, limit = 30): Promise<SearchResult[]> {
  await requireMember(userId, workspaceId);
  const tsq = toPrefixQuery(q);
  if (!tsq) return [];
  const like = `%${q.trim().replace(/[\\%_]/g, "\\$&")}%`;
  const opts = `StartSel=${HL_START}, StopSel=${HL_END}, MaxFragments=1, MaxWords=24, MinWords=10, ShortWord=2`;

  const pagesRes = await db.execute<{ id: string; title: string; icon: string | null; kind: string; context: string | null; snippet: string | null; archived: boolean; updated_at: string }>(sql`
    with q as (select to_tsquery('simple', ${tsq}) as si, to_tsquery('english', ${tsq}) as en)
    select * from (
      select p.id, p.title, p.icon, p.kind, p.archived_at is not null as archived, p.updated_at,
        parent.title as context,
        case when c.text_tsv @@ q.en then ts_headline('english', c.text, q.en, ${opts})
             when p.props_text <> '' and p.search_tsv @@ q.si then ts_headline('simple', p.props_text, q.si, ${opts})
             else null end as snippet,
        ts_rank(p.search_tsv, q.si) * 2 + coalesce(ts_rank(c.text_tsv, q.en), 0) + similarity(p.title, ${q}) as rank
      from pages p
      cross join q
      left join page_content c on c.page_id = p.id
      left join pages parent on parent.id = p.parent_id
      where p.workspace_id = ${workspaceId} and p.deleted_at is null and not p.is_template
        and (p.search_tsv @@ q.si or c.text_tsv @@ q.en or p.title ilike ${like})
      order by rank desc
      limit 200
    ) candidates
    where page_access(${userId}::uuid, candidates.id) >= 1
    order by rank desc
    limit ${limit}
  `);

  const commentsRes = await db.execute<{ id: string; page_id: string; title: string; icon: string | null; kind: string; snippet: string; updated_at: string }>(sql`
    with q as (select to_tsquery('english', ${tsq}) as en)
    select * from (
      select cm.id, p.id as page_id, p.title, p.icon, p.kind, cm.updated_at,
        ts_headline('english', cm.body, q.en, ${opts}) as snippet, ts_rank(cm.body_tsv, q.en) as rank
      from comments cm cross join q join pages p on p.id = cm.page_id
      where p.workspace_id = ${workspaceId} and p.deleted_at is null and cm.deleted_at is null and cm.body_tsv @@ q.en
      order by rank desc limit 100
    ) c
    where page_access(${userId}::uuid, c.page_id) >= 1
    order by rank desc limit 10
  `);

  return [
    ...pagesRes.map((r) => ({
      type: "page" as const,
      id: r.id,
      pageId: r.id,
      title: r.title,
      icon: r.icon,
      kind: r.kind,
      context: r.context,
      snippet: r.snippet,
      archived: r.archived,
      updatedAt: String(r.updated_at),
    })),
    ...commentsRes.map((r) => ({
      type: "comment" as const,
      id: r.id,
      pageId: r.page_id,
      title: r.title,
      icon: r.icon,
      kind: r.kind,
      context: "Comment",
      snippet: r.snippet,
      archived: false,
      updatedAt: String(r.updated_at),
    })),
  ];
}

/** Quick title lookup for @-mentions and link pickers. */
export async function suggestPages(userId: string, workspaceId: string, q: string, limit = 10) {
  await requireMember(userId, workspaceId);
  const like = `%${q.trim().replace(/[\\%_]/g, "\\$&")}%`;
  return db.execute<{ id: string; title: string; icon: string | null; kind: string }>(sql`
    select * from (
      select id, title, icon, kind, updated_at from pages
      where workspace_id = ${workspaceId} and deleted_at is null and not is_template and title ilike ${like}
      order by similarity(title, ${q}) desc, updated_at desc limit 50
    ) c where page_access(${userId}::uuid, c.id) >= 1 limit ${limit}
  `);
}
