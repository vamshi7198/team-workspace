-- Foreign keys that drizzle cannot express because of the pages <-> databases cycle.
ALTER TABLE "pages" ADD CONSTRAINT "pages_database_id_fk"
  FOREIGN KEY ("database_id") REFERENCES "databases"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_cover_file_id_fk"
  FOREIGN KEY ("cover_file_id") REFERENCES "files"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_parent_id_fk"
  FOREIGN KEY ("parent_id") REFERENCES "comments"("id") ON DELETE CASCADE;
--> statement-breakpoint

-- Effective access of a user to a page: 0 none, 1 view, 2 comment, 3 edit, 4 full.
--
-- Walk up from the page to the nearest page with an explicit general_access (the
-- "boundary"). Everything at or below the boundary contributes:
--   * owner of any page in that range             -> full
--   * explicit grants on any page in that range   -> granted level
--   * the boundary's general_access               -> for its audience: all workspace
--     members, or only teamspace members when the boundary belongs to a teamspace
-- Pages above a restricted boundary do not leak access downwards.
-- Non-members and disabled users always get 0.
CREATE OR REPLACE FUNCTION page_access(p_user uuid, p_page uuid) RETURNS smallint
LANGUAGE sql STABLE AS $$
  WITH RECURSIVE chain AS (
    SELECT p.id, p.parent_id, p.workspace_id, p.owner_id, p.general_access, p.teamspace_id, 0 AS depth
    FROM pages p WHERE p.id = p_page
    UNION ALL
    SELECT p.id, p.parent_id, p.workspace_id, p.owner_id, p.general_access, p.teamspace_id, c.depth + 1
    FROM pages p JOIN chain c ON p.id = c.parent_id
    WHERE c.depth < 100
  ),
  boundary AS (
    SELECT * FROM chain WHERE general_access <> 'inherit' ORDER BY depth LIMIT 1
  ),
  scope AS (
    SELECT c.* FROM chain c, boundary b WHERE c.depth <= b.depth
  ),
  is_member AS (
    SELECT EXISTS (
      SELECT 1 FROM workspace_members m
      JOIN "user" u ON u.id = m.user_id
      JOIN chain c ON c.depth = 0 AND c.workspace_id = m.workspace_id
      WHERE m.user_id = p_user AND u.disabled_at IS NULL
    ) AS ok
  )
  SELECT CASE WHEN NOT (SELECT ok FROM is_member) THEN 0::smallint ELSE GREATEST(
    (SELECT CASE WHEN EXISTS (SELECT 1 FROM scope WHERE owner_id = p_user) THEN 4 ELSE 0 END),
    (SELECT COALESCE(MAX(g.level), 0) FROM page_grants g JOIN scope s ON s.id = g.page_id WHERE g.user_id = p_user),
    (SELECT CASE b.general_access
              WHEN 'view' THEN 1 WHEN 'comment' THEN 2 WHEN 'edit' THEN 3 WHEN 'full' THEN 4 ELSE 0 END
       FROM boundary b
       WHERE b.teamspace_id IS NULL
          OR EXISTS (SELECT 1 FROM teamspace_members tm
                     WHERE tm.teamspace_id = b.teamspace_id AND tm.user_id = p_user)),
    0
  )::smallint END
$$;
