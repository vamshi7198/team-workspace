import "server-only";
import { createReadStream } from "node:fs";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { env } from "./env";

/**
 * Where uploaded bytes live. Local disk today; an S3-compatible implementation can be
 * added behind the same interface without touching callers.
 */
export interface Storage {
  put(key: string, data: Uint8Array): Promise<void>;
  /** Web stream of the object's bytes. */
  get(key: string): Promise<ReadableStream<Uint8Array>>;
  size(key: string): Promise<number | null>;
  delete(key: string): Promise<void>;
}

const KEY_RE = /^[0-9a-f-]{36}\/\d{4}\/\d{2}\/[0-9a-f-]{36}$/;

export class LocalDiskStorage implements Storage {
  constructor(private root: string) {}

  private resolve(key: string) {
    if (!KEY_RE.test(key)) throw new Error("Invalid storage key");
    const full = path.resolve(this.root, key);
    if (!full.startsWith(path.resolve(this.root) + path.sep)) throw new Error("Invalid storage key");
    return full;
  }

  async put(key: string, data: Uint8Array) {
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, data, { flag: "wx" });
  }

  async get(key: string) {
    return Readable.toWeb(createReadStream(this.resolve(key))) as ReadableStream<Uint8Array>;
  }

  async size(key: string) {
    try {
      return (await stat(this.resolve(key))).size;
    } catch {
      return null;
    }
  }

  async delete(key: string) {
    await rm(this.resolve(key), { force: true });
  }
}

let instance: Storage | undefined;
export function storage(): Storage {
  if (!instance) instance = new LocalDiskStorage(path.resolve(env().UPLOAD_DIR));
  return instance;
}

export function newStorageKey(workspaceId: string, id: string, now = new Date()) {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${workspaceId}/${y}/${m}/${id}`;
}
