import { sql, type SQL } from "drizzle-orm";
import { INVITE_ROLES, ROLES } from "../../lib/roles";
import {
  bigserial,
  bigint,
  boolean,
  type AnyPgColumn,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });
const now = () => timestamp({ withTimezone: true }).notNull().defaultNow();

// ---------------------------------------------------------------------------
// Better Auth tables (field names must match Better Auth's model).
// ---------------------------------------------------------------------------

export const user = pgTable("user", {
  id: uuid().primaryKey().defaultRandom(),
  name: text().notNull(),
  email: text().notNull().unique(),
  emailVerified: boolean().notNull().default(false),
  image: text(),
  createdAt: now(),
  updatedAt: now(),
  // Not a Better Auth field: set when an admin removes the user. Blocks new sessions.
  disabledAt: timestamp({ withTimezone: true }),
});

export const session = pgTable(
  "session",
  {
    id: uuid().primaryKey().defaultRandom(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    token: text().notNull().unique(),
    createdAt: now(),
    updatedAt: now(),
    ipAddress: text(),
    userAgent: text(),
    userId: uuid()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [index().on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: uuid().primaryKey().defaultRandom(),
    accountId: text().notNull(),
    providerId: text().notNull(),
    userId: uuid()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text(),
    refreshToken: text(),
    idToken: text(),
    accessTokenExpiresAt: timestamp({ withTimezone: true }),
    refreshTokenExpiresAt: timestamp({ withTimezone: true }),
    scope: text(),
    password: text(),
    createdAt: now(),
    updatedAt: now(),
  },
  (t) => [index().on(t.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: uuid().primaryKey().defaultRandom(),
    identifier: text().notNull(),
    value: text().notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: now(),
    updatedAt: now(),
  },
  (t) => [index().on(t.identifier)],
);

// ---------------------------------------------------------------------------
// Workspaces and membership
// ---------------------------------------------------------------------------

export const workspaces = pgTable("workspaces", {
  id: uuid().primaryKey().defaultRandom(),
  name: text().notNull(),
  icon: text(),
  createdAt: now(),
});

export { ROLES, INVITE_ROLES, type Role } from "../../lib/roles";

export const workspaceMembers = pgTable(
  "workspace_members",
  {
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text({ enum: ROLES }).notNull().default("member"),
    createdAt: now(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.userId] }),
    index().on(t.userId),
    check("workspace_members_role_check", sql`${t.role} in ('owner','admin','member','viewer')`),
    uniqueIndex("workspace_members_one_owner").on(t.workspaceId).where(sql`${t.role} = 'owner'`),
  ],
);

export const invitations = pgTable(
  "invitations",
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    email: text().notNull(),
    role: text({ enum: INVITE_ROLES }).notNull().default("member"),
    tokenHash: text().notNull().unique(),
    invitedBy: uuid().references(() => user.id, { onDelete: "set null" }),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    acceptedAt: timestamp({ withTimezone: true }),
    revokedAt: timestamp({ withTimezone: true }),
    createdAt: now(),
  },
  (t) => [index().on(t.workspaceId), check("invitations_role_check", sql`${t.role} in ('admin','member','viewer')`)],
);

export const teamspaces = pgTable(
  "teamspaces",
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text().notNull(),
    icon: text(),
    createdAt: now(),
  },
  (t) => [index().on(t.workspaceId)],
);

export const teamspaceMembers = pgTable(
  "teamspace_members",
  {
    teamspaceId: uuid()
      .notNull()
      .references(() => teamspaces.id, { onDelete: "cascade" }),
    userId: uuid()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: now(),
  },
  (t) => [primaryKey({ columns: [t.teamspaceId, t.userId] }), index().on(t.userId)],
);

// ---------------------------------------------------------------------------
// Pages. Documents, database containers and database rows are all pages, so
// permissions, comments, history and search work the same way for each.
// ---------------------------------------------------------------------------

export const PAGE_KINDS = ["page", "database", "row"] as const;
export const GENERAL_ACCESS = ["inherit", "none", "view", "comment", "edit", "full"] as const;
export type PageKind = (typeof PAGE_KINDS)[number];
export type GeneralAccess = (typeof GENERAL_ACCESS)[number];

export const pages = pgTable(
  "pages",
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    parentId: uuid().references((): AnyPgColumn => pages.id, { onDelete: "cascade" }),
    kind: text({ enum: PAGE_KINDS }).notNull().default("page"),
    // Copied to every descendant so teamspace membership can be checked without a tree walk.
    teamspaceId: uuid().references(() => teamspaces.id, { onDelete: "set null" }),
    ownerId: uuid().references(() => user.id, { onDelete: "set null" }),
    // Access for the audience (workspace members, or teamspace members when teamspaceId is set).
    // 'inherit' means "same as parent". Root pages always carry an explicit value.
    generalAccess: text({ enum: GENERAL_ACCESS }).notNull().default("inherit"),
    title: text().notNull().default(""),
    icon: text(),
    coverFileId: uuid(),
    sortKey: text().notNull().default("a0"),
    // For kind = 'row': the database this row belongs to. Values keyed by property id.
    databaseId: uuid(),
    props: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    // Plain-text rendering of props, maintained by the service layer for search.
    propsText: text().notNull().default(""),
    isTemplate: boolean().notNull().default(false),
    archivedAt: timestamp({ withTimezone: true }),
    deletedAt: timestamp({ withTimezone: true }),
    deletedBy: uuid(),
    createdBy: uuid().references(() => user.id, { onDelete: "set null" }),
    updatedBy: uuid().references(() => user.id, { onDelete: "set null" }),
    createdAt: now(),
    updatedAt: now(),
    searchTsv: tsvector().generatedAlwaysAs(
      (): SQL =>
        sql`setweight(to_tsvector('simple', coalesce(${pages.title}, '')), 'A') || setweight(to_tsvector('english', coalesce(${pages.propsText}, '')), 'B')`,
    ),
  },
  (t) => [
    index().on(t.workspaceId, t.parentId, t.sortKey),
    index().on(t.databaseId, t.sortKey),
    index().on(t.teamspaceId),
    index("pages_search_idx").using("gin", t.searchTsv),
    index("pages_title_trgm_idx").using("gin", sql`${t.title} gin_trgm_ops`),
    check(
      "pages_general_access_check",
      sql`${t.generalAccess} in ('inherit','none','view','comment','edit','full')`,
    ),
    check("pages_kind_check", sql`${t.kind} in ('page','database','row')`),
    check("pages_row_has_database", sql`(${t.kind} = 'row') = (${t.databaseId} is not null)`),
    check("pages_root_not_inherit", sql`${t.parentId} is not null or ${t.generalAccess} <> 'inherit'`),
  ],
);

export const pageContent = pgTable(
  "page_content",
  {
    pageId: uuid()
      .primaryKey()
      .references(() => pages.id, { onDelete: "cascade" }),
    doc: jsonb().notNull(),
    text: text().notNull().default(""),
    version: integer().notNull().default(0),
    updatedBy: uuid().references(() => user.id, { onDelete: "set null" }),
    updatedAt: now(),
    textTsv: tsvector().generatedAlwaysAs(
      (): SQL => sql`to_tsvector('english', coalesce(${pageContent.text}, ''))`,
    ),
  },
  (t) => [index("page_content_tsv_idx").using("gin", t.textTsv)],
);

export const pageVersions = pgTable(
  "page_versions",
  {
    id: uuid().primaryKey().defaultRandom(),
    pageId: uuid()
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    version: integer().notNull(),
    title: text().notNull(),
    doc: jsonb().notNull(),
    reason: text().notNull(),
    createdBy: uuid().references(() => user.id, { onDelete: "set null" }),
    createdAt: now(),
  },
  (t) => [index().on(t.pageId, t.createdAt)],
);

// level: 1 view, 2 comment, 3 edit, 4 full
export const pageGrants = pgTable(
  "page_grants",
  {
    pageId: uuid()
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    userId: uuid()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    level: smallint().notNull(),
    grantedBy: uuid().references(() => user.id, { onDelete: "set null" }),
    createdAt: now(),
  },
  (t) => [
    primaryKey({ columns: [t.pageId, t.userId] }),
    index().on(t.userId),
    check("page_grants_level_check", sql`${t.level} between 1 and 4`),
  ],
);

export const favorites = pgTable(
  "favorites",
  {
    userId: uuid()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    pageId: uuid()
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    sortKey: text().notNull().default("a0"),
    createdAt: now(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.pageId] })],
);

export const pageVisits = pgTable(
  "page_visits",
  {
    userId: uuid()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    pageId: uuid()
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    visitedAt: now(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.pageId] }), index().on(t.userId, t.visitedAt)],
);

// Links found in page content (mentions, sub-page blocks) — used for backlinks.
export const pageLinks = pgTable(
  "page_links",
  {
    fromPageId: uuid()
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    toPageId: uuid()
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.fromPageId, t.toPageId] }), index().on(t.toPageId)],
);

// ---------------------------------------------------------------------------
// Databases
// ---------------------------------------------------------------------------

export const PROPERTY_TYPES = [
  "title",
  "text",
  "number",
  "status",
  "select",
  "multi_select",
  "date",
  "checkbox",
  "url",
  "email",
  "person",
  "created_time",
  "edited_time",
  "created_by",
  "relation",
  "formula",
  "rollup",
] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];

export const VIEW_TYPES = ["table", "board", "calendar", "list"] as const;
export type ViewType = (typeof VIEW_TYPES)[number];

export const databases = pgTable(
  "databases",
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    pageId: uuid()
      .notNull()
      .unique()
      .references(() => pages.id, { onDelete: "cascade" }),
    // 'projects' | 'tasks' | 'meetings' for the built-in databases.
    systemKey: text(),
    // Document used as the starting content of new rows (e.g. the meeting template).
    rowTemplate: jsonb(),
    createdAt: now(),
  },
  (t) => [uniqueIndex().on(t.workspaceId, t.systemKey)],
);

export const dbProperties = pgTable(
  "db_properties",
  {
    id: uuid().primaryKey().defaultRandom(),
    databaseId: uuid()
      .notNull()
      .references(() => databases.id, { onDelete: "cascade" }),
    name: text().notNull(),
    type: text({ enum: PROPERTY_TYPES }).notNull(),
    config: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    // Stable key for built-in properties so code can find "Status" even if renamed.
    systemKey: text(),
    position: integer().notNull().default(0),
    createdAt: now(),
  },
  (t) => [index().on(t.databaseId, t.position)],
);

export const dbViews = pgTable(
  "db_views",
  {
    id: uuid().primaryKey().defaultRandom(),
    databaseId: uuid()
      .notNull()
      .references(() => databases.id, { onDelete: "cascade" }),
    name: text().notNull(),
    type: text({ enum: VIEW_TYPES }).notNull(),
    config: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    position: integer().notNull().default(0),
    createdAt: now(),
  },
  (t) => [index().on(t.databaseId, t.position)],
);

// Relation values. One row per link, stored under the "forward" property; the
// reverse property on the other database reads the same rows the other way round.
export const relationLinks = pgTable(
  "relation_links",
  {
    propertyId: uuid()
      .notNull()
      .references(() => dbProperties.id, { onDelete: "cascade" }),
    fromPageId: uuid()
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    toPageId: uuid()
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    createdAt: now(),
  },
  (t) => [
    primaryKey({ columns: [t.propertyId, t.fromPageId, t.toPageId] }),
    index().on(t.toPageId),
  ],
);

// Meeting action item (a to-do block) → task row. Unique per block, so repeating
// the conversion never creates a second task.
export const actionItemTasks = pgTable(
  "action_item_tasks",
  {
    meetingPageId: uuid()
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    blockId: text().notNull(),
    taskPageId: uuid()
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    createdBy: uuid().references(() => user.id, { onDelete: "set null" }),
    createdAt: now(),
  },
  (t) => [primaryKey({ columns: [t.meetingPageId, t.blockId] }), index().on(t.taskPageId)],
);

// ---------------------------------------------------------------------------
// Comments, files, activity, audit
// ---------------------------------------------------------------------------

export const comments = pgTable(
  "comments",
  {
    id: uuid().primaryKey().defaultRandom(),
    pageId: uuid()
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    parentId: uuid(),
    authorId: uuid().references(() => user.id, { onDelete: "set null" }),
    body: text().notNull(),
    resolvedAt: timestamp({ withTimezone: true }),
    deletedAt: timestamp({ withTimezone: true }),
    createdAt: now(),
    updatedAt: now(),
    bodyTsv: tsvector().generatedAlwaysAs(
      (): SQL => sql`to_tsvector('english', coalesce(${comments.body}, ''))`,
    ),
  },
  (t) => [index().on(t.pageId, t.createdAt), index("comments_tsv_idx").using("gin", t.bodyTsv)],
);

export const files = pgTable(
  "files",
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    pageId: uuid().references(() => pages.id, { onDelete: "set null" }),
    storageKey: text().notNull().unique(),
    originalName: text().notNull(),
    mimeType: text().notNull(),
    size: bigint({ mode: "number" }).notNull(),
    sha256: text().notNull(),
    uploadedBy: uuid().references(() => user.id, { onDelete: "set null" }),
    createdAt: now(),
  },
  (t) => [index().on(t.pageId)],
);

export const activity = pgTable(
  "activity",
  {
    id: bigserial({ mode: "number" }).primaryKey(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    pageId: uuid().references(() => pages.id, { onDelete: "cascade" }),
    actorId: uuid().references(() => user.id, { onDelete: "set null" }),
    action: text().notNull(),
    meta: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    createdAt: now(),
  },
  (t) => [index().on(t.pageId, t.createdAt), index().on(t.workspaceId, t.createdAt)],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial({ mode: "number" }).primaryKey(),
    workspaceId: uuid().references(() => workspaces.id, { onDelete: "set null" }),
    actorId: uuid().references(() => user.id, { onDelete: "set null" }),
    action: text().notNull(),
    target: text(),
    meta: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    ip: text(),
    createdAt: now(),
  },
  (t) => [index().on(t.workspaceId, t.createdAt)],
);
