// Workspace roles, shared by the server (enforcement) and the UI (what to show).
//   owner:  exactly one per workspace; everything an admin can do, plus managing admins.
//   admin:  members, invitations, teamspaces, settings, audit log, workspace export.
//   member: creates and edits content.
//   viewer: reads and searches; can't create, edit, comment or upload (capped in page_access()).
export const ROLES = ["owner", "admin", "member", "viewer"] as const;
export type Role = (typeof ROLES)[number];
export const INVITE_ROLES = ["admin", "member", "viewer"] as const;
export type InviteRole = (typeof INVITE_ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = { owner: "Owner", admin: "Admin", member: "Member", viewer: "Viewer" };

export const isAdminRole = (role: Role) => role === "owner" || role === "admin";
export const canContribute = (role: Role) => role !== "viewer";

/**
 * Whether `actor` may manage (change the role of, remove, sign out, reset the password of)
 * `target`. The owner manages everyone else; admins manage members and viewers only, so an
 * admin can never take over the owner's or another admin's account.
 */
export function canManage(actor: Role, target: Role) {
  if (actor === "owner") return target !== "owner";
  if (actor === "admin") return target === "member" || target === "viewer";
  return false;
}

/** Roles `actor` may give to someone it manages. "owner" means transferring ownership. */
export const assignableRoles = (actor: Role): Role[] => (actor === "owner" ? ["owner", "admin", "member", "viewer"] : actor === "admin" ? ["member", "viewer"] : []);
