// Runs once when the Node.js server starts. Schedules light maintenance in-process
// (no separate worker or Redis needed at this scale).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NODE_ENV === "test") return;
  const { logger } = await import("./server/logger");
  const { purgeOldTrash } = await import("./server/services/pages");
  const { purgeOrphanFiles } = await import("./server/services/files");

  const run = async () => {
    try {
      const pages = await purgeOldTrash(Number(process.env.TRASH_RETENTION_DAYS ?? 30));
      const files = await purgeOrphanFiles();
      if (pages || files) logger.info({ pages, files }, "maintenance: purged old trash and orphan files");
    } catch (err) {
      logger.error({ err: (err as Error).message }, "maintenance failed");
    }
  };
  setTimeout(run, 60_000);
  setInterval(run, 6 * 60 * 60 * 1000).unref();
}
