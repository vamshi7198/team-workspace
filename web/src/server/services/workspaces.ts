import { createHash, randomBytes } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { and, asc, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import { account, invitations, session, teamspaceMembers, teamspaces, user, workspaceMembers, workspaces } from "../db/schema";
import type { InviteRole, Role } from "@/lib/roles";
import { env } from "../env";
import { badRequest, conflict, forbidden, notFound } from "../errors";
import { sendMail } from "../mail";
import { audit } from "./audit";
import { requireAdmin, requireCanManage, requireMember } from "./permissions";
import { bootstrapWorkspace } from "./system";

const INVITE_TTL_DAYS = 7;
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** First-run setup (CLI): creates the workspace and its owner account. */
export async function createWorkspaceWithAdmin(input: { workspaceName: string; adminEmail: string; adminName: string; password: string }) {
  if (input.password.length < 10) throw badRequest("Password must be at least 10 characters");
  return db.transaction(async (tx) => {
    const email = input.adminEmail.trim().toLowerCase();
    let [u] = await tx.select().from(user).where(eq(user.email, email));
    if (!u) {
      [u] = await tx.insert(user).values({ email, name: input.adminName, emailVerified: true }).returning();
      await tx.insert(account).values({ userId: u.id, accountId: u.id, providerId: "credential", password: await hashPassword(input.password) });
    }
    const [ws] = await tx.insert(workspaces).values({ name: input.workspaceName }).returning();
    await tx.insert(workspaceMembers).values({ workspaceId: ws.id, userId: u.id, role: "owner" });
    const dbs = await bootstrapWorkspace(tx, ws.id, u.id);
    await audit({ workspaceId: ws.id, actorId: u.id, action: "workspace.created" }, tx);
    return { workspace: ws, user: u, databases: dbs };
  });
}

export async function listMyWorkspaces(userId: string) {
  return db
    .select({ id: workspaces.id, name: workspaces.name, icon: workspaces.icon, role: workspaceMembers.role })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(eq(workspaceMembers.userId, userId))
    .orderBy(asc(workspaces.createdAt));
}

export async function renameWorkspace(userId: string, workspaceId: string, name: string, ip: string | null) {
  await requireAdmin(userId, workspaceId);
  await db.update(workspaces).set({ name: name.trim().slice(0, 100) }).where(eq(workspaces.id, workspaceId));
  await audit({ workspaceId, actorId: userId, action: "workspace.renamed", meta: { name }, ip });
}

export async function listMembers(userId: string, workspaceId: string) {
  await requireMember(userId, workspaceId);
  return db
    .select({ id: user.id, name: user.name, email: user.email, image: user.image, role: workspaceMembers.role, disabledAt: user.disabledAt, joinedAt: workspaceMembers.createdAt })
    .from(workspaceMembers)
    .innerJoin(user, eq(user.id, workspaceMembers.userId))
    .where(eq(workspaceMembers.workspaceId, workspaceId))
    .orderBy(asc(user.name));
}

// ---- invitations -----------------------------------------------------------

export async function createInvitation(userId: string, workspaceId: string, input: { email: string; role: InviteRole }, ip: string | null) {
  const actor = await requireAdmin(userId, workspaceId);
  if (input.role === "admin" && actor !== "owner") throw forbidden("Only the workspace owner can invite admins");
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw badRequest("Enter a valid email address");
  const [existing] = await db
    .select()
    .from(workspaceMembers)
    .innerJoin(user, eq(user.id, workspaceMembers.userId))
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(user.email, email)));
  if (existing && !existing.user.disabledAt) throw conflict("That person is already a member");

  // Revoke older pending invitations for the same address.
  await db.update(invitations).set({ revokedAt: new Date() }).where(and(eq(invitations.workspaceId, workspaceId), eq(invitations.email, email), isNull(invitations.acceptedAt), isNull(invitations.revokedAt)));
  const token = randomBytes(32).toString("base64url");
  const [inv] = await db
    .insert(invitations)
    .values({ workspaceId, email, role: input.role, tokenHash: sha256(token), invitedBy: userId, expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 864e5) })
    .returning();
  const url = `${env().APP_URL}/invite/${token}`;
  const [ws] = await db.select({ name: workspaces.name }).from(workspaces).where(eq(workspaces.id, workspaceId));
  const emailed = await sendMail(
    email,
    `You're invited to ${ws.name}`,
    `You've been invited to join the ${ws.name} workspace.\n\nAccept the invitation and choose a password (link valid for ${INVITE_TTL_DAYS} days):\n${url}\n`,
  );
  await audit({ workspaceId, actorId: userId, action: "invitation.created", target: email, meta: { role: input.role, emailed }, ip });
  // The link is returned to the admin so it can be shared manually when email is not configured.
  return { id: inv.id, email, role: inv.role, expiresAt: inv.expiresAt, url, emailed };
}

export async function listInvitations(userId: string, workspaceId: string) {
  await requireAdmin(userId, workspaceId);
  return db
    .select({ id: invitations.id, email: invitations.email, role: invitations.role, expiresAt: invitations.expiresAt, createdAt: invitations.createdAt })
    .from(invitations)
    .where(and(eq(invitations.workspaceId, workspaceId), isNull(invitations.acceptedAt), isNull(invitations.revokedAt), gt(invitations.expiresAt, new Date())))
    .orderBy(asc(invitations.createdAt));
}

export async function revokeInvitation(userId: string, workspaceId: string, invitationId: string, ip: string | null) {
  await requireAdmin(userId, workspaceId);
  const res = await db.update(invitations).set({ revokedAt: new Date() }).where(and(eq(invitations.id, invitationId), eq(invitations.workspaceId, workspaceId))).returning();
  if (!res.length) throw notFound("Invitation not found");
  await audit({ workspaceId, actorId: userId, action: "invitation.revoked", target: res[0].email, ip });
}

async function findValidInvitation(token: string) {
  const [inv] = await db
    .select({ inv: invitations, workspaceName: workspaces.name })
    .from(invitations)
    .innerJoin(workspaces, eq(workspaces.id, invitations.workspaceId))
    .where(eq(invitations.tokenHash, sha256(token)));
  if (!inv || inv.inv.acceptedAt || inv.inv.revokedAt || inv.inv.expiresAt < new Date()) return null;
  return inv;
}

export async function describeInvitation(token: string) {
  const found = await findValidInvitation(token);
  if (!found) throw notFound("This invitation is invalid or has expired");
  const [existing] = await db.select({ id: user.id }).from(user).where(eq(user.email, found.inv.email));
  return { email: found.inv.email, workspaceName: found.workspaceName, existingAccount: Boolean(existing) };
}

/**
 * Accepts an invitation. New people choose a name and password here; people who
 * already have an account (e.g. from another workspace) must sign in first.
 */
export async function acceptInvitation(token: string, input: { name?: string; password?: string; signedInUserId?: string | null }, ip: string | null) {
  return db.transaction(async (tx) => {
    const found = await findValidInvitation(token);
    if (!found) throw notFound("This invitation is invalid or has expired");
    const { inv } = found;
    let [u] = await tx.select().from(user).where(eq(user.email, inv.email));
    if (u) {
      if (input.signedInUserId !== u.id) throw forbidden("Sign in as the invited account to accept this invitation");
      if (u.disabledAt) await tx.update(user).set({ disabledAt: null }).where(eq(user.id, u.id));
    } else {
      if (!input.name?.trim()) throw badRequest("Enter your name");
      if (!input.password || input.password.length < 10) throw badRequest("Password must be at least 10 characters");
      [u] = await tx.insert(user).values({ email: inv.email, name: input.name.trim().slice(0, 100), emailVerified: true }).returning();
      await tx.insert(account).values({ userId: u.id, accountId: u.id, providerId: "credential", password: await hashPassword(input.password) });
    }
    await tx
      .insert(workspaceMembers)
      .values({ workspaceId: inv.workspaceId, userId: u.id, role: inv.role })
      .onConflictDoUpdate({ target: [workspaceMembers.workspaceId, workspaceMembers.userId], set: { role: inv.role }, setWhere: sql`${workspaceMembers.role} <> 'owner'` });
    await tx.update(invitations).set({ acceptedAt: new Date() }).where(eq(invitations.id, inv.id));
    await audit({ workspaceId: inv.workspaceId, actorId: u.id, action: "invitation.accepted", target: inv.email, ip }, tx);
    return { email: inv.email, workspaceId: inv.workspaceId };
  });
}

// ---- member management -----------------------------------------------------

/**
 * Changes a member's role. Admins can switch members and viewers; only the owner can make or
 * unmake admins. Making someone the owner transfers ownership: the old owner becomes an admin.
 */
export async function changeRole(userId: string, workspaceId: string, targetId: string, role: Role, ip: string | null) {
  const { actor, target } = await requireCanManage(userId, workspaceId, targetId);
  if ((role === "owner" || role === "admin") && actor !== "owner") throw forbidden("Only the workspace owner can make admins");
  const where = (id: string) => and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, id));
  if (role === target) return;
  await db.transaction(async (tx) => {
    if (role === "owner") {
      // Demote first: the one-owner unique index would reject two owners at once.
      await tx.update(workspaceMembers).set({ role: "admin" }).where(where(userId));
      await audit({ workspaceId, actorId: userId, action: "workspace.ownership_transferred", target: targetId, ip }, tx);
    }
    await tx.update(workspaceMembers).set({ role }).where(where(targetId));
    await audit({ workspaceId, actorId: userId, action: "member.role_changed", target: targetId, meta: { from: target, role }, ip }, tx);
  });
}

/**
 * Removes a member: membership and teamspace memberships are deleted, all their
 * sessions are revoked, and (if they belong to no other workspace) the account is
 * disabled. Pages they own are kept.
 */
export async function removeMember(userId: string, workspaceId: string, targetId: string, ip: string | null) {
  if (targetId === userId) throw badRequest("You cannot remove yourself");
  await requireCanManage(userId, workspaceId, targetId);
  return db.transaction(async (tx) => {
    await tx.delete(workspaceMembers).where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, targetId)));
    await tx.execute(sql`delete from teamspace_members where user_id = ${targetId} and teamspace_id in (select id from teamspaces where workspace_id = ${workspaceId})`);
    await tx.execute(sql`delete from page_grants where user_id = ${targetId} and page_id in (select id from pages where workspace_id = ${workspaceId})`);
    const [other] = await tx.select().from(workspaceMembers).where(eq(workspaceMembers.userId, targetId)).limit(1);
    if (!other) await tx.update(user).set({ disabledAt: new Date() }).where(eq(user.id, targetId));
    await tx.delete(session).where(eq(session.userId, targetId));
    await audit({ workspaceId, actorId: userId, action: "member.removed", target: targetId, ip }, tx);
  });
}

/** Revokes every session of a member (e.g. lost laptop). */
export async function revokeMemberSessions(userId: string, workspaceId: string, targetId: string, ip: string | null) {
  if (targetId !== userId) await requireCanManage(userId, workspaceId, targetId);
  else await requireMember(userId, workspaceId);
  await db.delete(session).where(eq(session.userId, targetId));
  await audit({ workspaceId, actorId: userId, action: "member.sessions_revoked", target: targetId, ip });
}

export async function listAudit(userId: string, workspaceId: string) {
  await requireAdmin(userId, workspaceId);
  return db.execute<{ id: number; action: string; target: string | null; meta: Record<string, unknown>; ip: string | null; created_at: string; actor: string | null }>(sql`
    select a.id, a.action, a.target, a.meta, a.ip, a.created_at, u.name as actor
    from audit_log a left join "user" u on u.id = a.actor_id
    where a.workspace_id = ${workspaceId} order by a.created_at desc limit 300
  `);
}

// ---- teamspaces ------------------------------------------------------------

export async function listTeamspaces(userId: string, workspaceId: string) {
  await requireMember(userId, workspaceId);
  return db.execute<{ id: string; name: string; icon: string | null; is_member: boolean; member_count: number }>(sql`
    select t.id, t.name, t.icon,
      exists(select 1 from teamspace_members m where m.teamspace_id = t.id and m.user_id = ${userId}) as is_member,
      (select count(*)::int from teamspace_members m where m.teamspace_id = t.id) as member_count
    from teamspaces t where t.workspace_id = ${workspaceId} order by t.name
  `);
}

export async function createTeamspace(userId: string, workspaceId: string, input: { name: string; icon?: string | null; memberIds?: string[] }, ip: string | null) {
  await requireAdmin(userId, workspaceId);
  return db.transaction(async (tx) => {
    const [t] = await tx.insert(teamspaces).values({ workspaceId, name: input.name.trim().slice(0, 100), icon: input.icon ?? null }).returning();
    const ids = [...new Set([userId, ...(input.memberIds ?? [])])];
    for (const id of ids) {
      const [m] = await tx.select().from(workspaceMembers).where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, id)));
      if (m) await tx.insert(teamspaceMembers).values({ teamspaceId: t.id, userId: id }).onConflictDoNothing();
    }
    await audit({ workspaceId, actorId: userId, action: "teamspace.created", target: t.id, meta: { name: t.name }, ip }, tx);
    return t;
  });
}

export async function setTeamspaceMember(userId: string, workspaceId: string, teamspaceId: string, targetId: string, member: boolean, ip: string | null) {
  await requireAdmin(userId, workspaceId);
  const [t] = await db.select().from(teamspaces).where(and(eq(teamspaces.id, teamspaceId), eq(teamspaces.workspaceId, workspaceId)));
  if (!t) throw notFound("Teamspace not found");
  if (member) {
    await requireMember(targetId, workspaceId);
    await db.insert(teamspaceMembers).values({ teamspaceId, userId: targetId }).onConflictDoNothing();
  } else {
    await db.delete(teamspaceMembers).where(and(eq(teamspaceMembers.teamspaceId, teamspaceId), eq(teamspaceMembers.userId, targetId)));
  }
  await audit({ workspaceId, actorId: userId, action: member ? "teamspace.member_added" : "teamspace.member_removed", target: teamspaceId, meta: { user: targetId }, ip });
}

export async function teamspaceMemberIds(userId: string, workspaceId: string, teamspaceId: string) {
  await requireMember(userId, workspaceId);
  const rows = await db.select({ userId: teamspaceMembers.userId }).from(teamspaceMembers).innerJoin(teamspaces, eq(teamspaces.id, teamspaceMembers.teamspaceId)).where(and(eq(teamspaceMembers.teamspaceId, teamspaceId), eq(teamspaces.workspaceId, workspaceId)));
  return rows.map((r) => r.userId);
}
