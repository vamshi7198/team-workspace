import { createHash } from "node:crypto";
import { fileTypeFromBuffer } from "file-type";
import { and, eq, isNull, lt } from "drizzle-orm";
import { db, type DbOrTx } from "../db";
import { files } from "../db/schema";
import { env } from "../env";
import { badRequest, notFound } from "../errors";
import { logger } from "../logger";
import { newStorageKey, storage } from "../storage";
import { Access, requirePage } from "./permissions";

// Detected (magic bytes) types we accept. Anything else is rejected.
const BINARY_TYPES: Record<string, { inline: boolean }> = {
  "image/png": { inline: true },
  "image/jpeg": { inline: true },
  "image/gif": { inline: true },
  "image/webp": { inline: true },
  "image/avif": { inline: true },
  "video/mp4": { inline: true },
  "video/webm": { inline: true },
  "audio/mpeg": { inline: true },
  "audio/wav": { inline: true },
  "application/pdf": { inline: false },
  "application/zip": { inline: false },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { inline: false },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": { inline: false },
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": { inline: false },
  "application/vnd.oasis.opendocument.text": { inline: false },
  "application/vnd.oasis.opendocument.spreadsheet": { inline: false },
  "application/x-cfb": { inline: false }, // legacy .doc/.xls/.ppt
};
// Plain-text files have no magic bytes; accepted by extension if the bytes are valid UTF-8.
const TEXT_EXTENSIONS: Record<string, string> = {
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".csv": "text/csv",
  ".json": "application/json",
  ".log": "text/plain",
};

function textMime(name: string, data: Uint8Array): string | null {
  const ext = name.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? "";
  const mime = TEXT_EXTENSIONS[ext];
  if (!mime) return null;
  if (data.includes(0)) return null;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(data);
    return mime;
  } catch {
    return null;
  }
}

export function safeFileName(name: string) {
  const cleaned = name.replace(/[\\/\0\r\n"<>:|?*]+/g, "_").replace(/^\.+/, "").trim();
  return (cleaned || "file").slice(0, 200);
}

export async function detectMime(name: string, data: Uint8Array): Promise<string> {
  const detected = await fileTypeFromBuffer(data);
  if (detected && BINARY_TYPES[detected.mime]) return detected.mime;
  const t = !detected ? textMime(name, data) : null;
  if (t) return t;
  throw badRequest("This file type is not allowed. Images, PDFs, Office documents, archives and text files are supported.");
}

export const isInline = (mime: string) => BINARY_TYPES[mime]?.inline ?? false;

/** Stores a file attached to a page. The uploader needs edit access to the page. */
export async function uploadFile(userId: string, input: { pageId: string; name: string; data: Uint8Array }, tx: DbOrTx = db, opts: { skipAccessCheck?: boolean } = {}) {
  const max = env().MAX_UPLOAD_MB * 1024 * 1024;
  if (input.data.byteLength === 0) throw badRequest("The file is empty");
  if (input.data.byteLength > max) throw badRequest(`Files must be smaller than ${env().MAX_UPLOAD_MB} MB`);
  const page = opts.skipAccessCheck
    ? (await tx.query.pages.findFirst({ where: (p, { eq: e }) => e(p.id, input.pageId) }))!
    : (await requirePage(userId, input.pageId, Access.edit, {}, tx)).page;
  const mimeType = await detectMime(input.name, input.data);
  const id = crypto.randomUUID();
  const key = newStorageKey(page.workspaceId, id);
  await storage().put(key, input.data);
  const sha256 = createHash("sha256").update(input.data).digest("hex");
  try {
    const [row] = await tx
      .insert(files)
      .values({ id, workspaceId: page.workspaceId, pageId: page.id, storageKey: key, originalName: safeFileName(input.name), mimeType, size: input.data.byteLength, sha256, uploadedBy: userId })
      .returning();
    return row;
  } catch (err) {
    await storage().delete(key);
    throw err;
  }
}

/** Authorises and opens a file for download. Access follows the page it is attached to. */
export async function openFile(userId: string, fileId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(fileId)) throw notFound("File not found");
  const [f] = await db.select().from(files).where(eq(files.id, fileId));
  if (!f) throw notFound("File not found");
  if (f.pageId) await requirePage(userId, f.pageId, Access.view);
  else if (f.uploadedBy !== userId) throw notFound("File not found");
  return { file: f, stream: await storage().get(f.storageKey) };
}

/** Deletes files whose page was permanently deleted. */
export async function purgeOrphanFiles(olderThanHours = 24) {
  const orphans = await db
    .select()
    .from(files)
    .where(and(isNull(files.pageId), lt(files.createdAt, new Date(Date.now() - olderThanHours * 36e5))));
  for (const f of orphans) {
    try {
      await storage().delete(f.storageKey);
      await db.delete(files).where(eq(files.id, f.id));
    } catch (err) {
      logger.error({ err: (err as Error).message, fileId: f.id }, "failed to purge orphan file");
    }
  }
  return orphans.length;
}
