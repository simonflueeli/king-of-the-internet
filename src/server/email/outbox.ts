// OWNER: G. Read back the dev outbox written by OutboxEmailProvider (for /dev/outbox).
import { readFile } from "node:fs/promises";
import path from "node:path";
import { OUTBOX_DIR, type OutboxMeta } from "./provider";

const ID = /^outbox_[0-9a-f-]{36}$/;

export const isOutboxId = (id: string) => ID.test(id);

export async function readOutboxMeta(id: string): Promise<OutboxMeta | null> {
  if (!isOutboxId(id)) return null;
  try {
    return JSON.parse(await readFile(path.join(OUTBOX_DIR, `${id}.json`), "utf8")) as OutboxMeta;
  } catch {
    return null;
  }
}

export async function readOutboxHtml(id: string): Promise<string | null> {
  if (!isOutboxId(id)) return null;
  try {
    return await readFile(path.join(OUTBOX_DIR, `${id}.html`), "utf8");
  } catch {
    return null;
  }
}
