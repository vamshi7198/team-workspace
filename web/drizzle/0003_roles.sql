ALTER TABLE "workspace_members" DROP CONSTRAINT "workspace_members_role_check";--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_members_one_owner" ON "workspace_members" USING btree ("workspace_id") WHERE "workspace_members"."role" = 'owner';--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_role_check" CHECK ("invitations"."role" in ('admin','member','viewer'));--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_role_check" CHECK ("workspace_members"."role" in ('owner','admin','member','viewer'));--> statement-breakpoint

-- Every existing workspace gets an owner: the admin who created it (from the audit log),
-- otherwise its longest-standing admin.
UPDATE "workspace_members" m SET "role" = 'owner'
FROM (
  SELECT DISTINCT ON (wm.workspace_id) wm.workspace_id, wm.user_id
  FROM "workspace_members" wm
  LEFT JOIN "audit_log" a ON a.workspace_id = wm.workspace_id AND a.actor_id = wm.user_id AND a.action = 'workspace.created'
  WHERE wm.role = 'admin'
  ORDER BY wm.workspace_id, (a.id IS NULL), wm.created_at
) pick
WHERE m.workspace_id = pick.workspace_id AND m.user_id = pick.user_id
  AND NOT EXISTS (SELECT 1 FROM "workspace_members" o WHERE o.workspace_id = m.workspace_id AND o.role = 'owner');
--> statement-breakpoint

-- Same rules as 0002, plus: viewers never get more than view access (1), whatever their
-- ownership, grants or the page's general access say.
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
  member AS (
    SELECT m.role FROM workspace_members m
    JOIN "user" u ON u.id = m.user_id
    JOIN chain c ON c.depth = 0 AND c.workspace_id = m.workspace_id
    WHERE m.user_id = p_user AND u.disabled_at IS NULL
  )
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM member) THEN 0::smallint ELSE LEAST(
    GREATEST(
      (SELECT CASE WHEN EXISTS (SELECT 1 FROM scope WHERE owner_id = p_user) THEN 4 ELSE 0 END),
      (SELECT COALESCE(MAX(g.level), 0) FROM page_grants g JOIN scope s ON s.id = g.page_id WHERE g.user_id = p_user),
      (SELECT CASE b.general_access
                WHEN 'view' THEN 1 WHEN 'comment' THEN 2 WHEN 'edit' THEN 3 WHEN 'full' THEN 4 ELSE 0 END
         FROM boundary b
         WHERE b.teamspace_id IS NULL
            OR EXISTS (SELECT 1 FROM teamspace_members tm
                       WHERE tm.teamspace_id = b.teamspace_id AND tm.user_id = p_user)),
      0
    ),
    CASE WHEN (SELECT role FROM member) = 'viewer' THEN 1 ELSE 4 END
  )::smallint END
$$;
