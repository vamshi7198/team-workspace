// Who else has a page open. In-memory (single app process); entries expire after 45s
// without a heartbeat. Used to warn people before they edit the same page.
const TTL_MS = 45_000;
const pagesOpen = new Map<string, Map<string, { name: string; at: number; editing: boolean }>>();

export function heartbeat(pageId: string, user: { id: string; name: string }, editing: boolean) {
  const now = Date.now();
  let viewers = pagesOpen.get(pageId);
  if (!viewers) pagesOpen.set(pageId, (viewers = new Map()));
  viewers.set(user.id, { name: user.name, at: now, editing });
  const others: { id: string; name: string; editing: boolean }[] = [];
  for (const [id, v] of viewers) {
    if (now - v.at > TTL_MS) viewers.delete(id);
    else if (id !== user.id) others.push({ id, name: v.name, editing: v.editing });
  }
  return others;
}

export function leave(pageId: string, userId: string) {
  pagesOpen.get(pageId)?.delete(userId);
}
