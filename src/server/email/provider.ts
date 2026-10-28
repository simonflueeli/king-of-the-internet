// OWNER: G. Transactional email delivery. Resend when RESEND_API_KEY is set, otherwise the dev
// outbox (HTML + JSON files in .data/outbox, listed at /dev/outbox). email_log rows are written by
// src/server/notifications for every provider, so rate limits behave the same in dev and production.
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { nowMs } from "../clock";

export type EmailType = "receipt" | "overthrow" | "removal" | "refund";

export interface EmailMessage {
  type: EmailType;
  to: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
  /** Provider-side de-duplication (Resend Idempotency-Key). */
  idempotencyKey?: string;
}

export interface EmailProvider {
  name: "resend" | "outbox" | "fake";
  /** Resolves with the provider's message id; rejects when the email was not accepted. */
  send(msg: EmailMessage): Promise<{ id: string }>;
}

export const OUTBOX_DIR = path.join(process.cwd(), ".data", "outbox");
const SEND_TIMEOUT_MS = 15_000;

export function emailFrom(): string {
  return process.env.EMAIL_FROM || "The Throne <throne@localhost>";
}

/** Support address shown in emails: SUPPORT_EMAIL, else the address part of EMAIL_FROM. */
export function supportEmail(): string {
  if (process.env.SUPPORT_EMAIL) return process.env.SUPPORT_EMAIL;
  const from = emailFrom();
  return from.match(/<([^>]+)>/)?.[1] ?? from;
}

export class ResendEmailProvider implements EmailProvider {
  readonly name = "resend" as const;
  constructor(private readonly apiKey: string) {}

  async send(msg: EmailMessage): Promise<{ id: string }> {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
        ...(msg.idempotencyKey ? { "idempotency-key": msg.idempotencyKey } : {}),
      },
      body: JSON.stringify({
        from: emailFrom(),
        to: [msg.to],
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
        headers: msg.headers,
        tags: [{ name: "type", value: msg.type }],
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    const body = (await res.json().catch(() => null)) as { id?: string; message?: string } | null;
    if (!res.ok || !body?.id) {
      throw new Error(`Resend rejected the email (${res.status}): ${body?.message ?? "no message"}`);
    }
    return { id: body.id };
  }
}

/** Stored next to each outbox HTML file; read back by /dev/outbox. */
export interface OutboxMeta {
  id: string;
  type: EmailType;
  from: string;
  to: string;
  subject: string;
  headers: Record<string, string>;
  text: string;
  createdAt: string;
}

export class OutboxEmailProvider implements EmailProvider {
  readonly name = "outbox" as const;
  constructor(private readonly dir = OUTBOX_DIR) {}

  async send(msg: EmailMessage): Promise<{ id: string }> {
    const id = `outbox_${randomUUID()}`;
    const meta: OutboxMeta = {
      id,
      type: msg.type,
      from: emailFrom(),
      to: msg.to,
      subject: msg.subject,
      headers: msg.headers ?? {},
      text: msg.text,
      createdAt: new Date(nowMs()).toISOString(),
    };
    await mkdir(this.dir, { recursive: true });
    await writeFile(path.join(this.dir, `${id}.html`), msg.html, "utf8");
    await writeFile(path.join(this.dir, `${id}.json`), JSON.stringify(meta, null, 2), "utf8");
    console.info(`[email] outbox: ${msg.type} to ${msg.to} → /dev/outbox?id=${id}`);
    return { id };
  }
}

/** In-memory provider for tests. `failNext` makes the next sends reject. */
export class FakeEmailProvider implements EmailProvider {
  readonly name = "fake" as const;
  readonly sent: (EmailMessage & { id: string })[] = [];
  failNext = 0;

  async send(msg: EmailMessage): Promise<{ id: string }> {
    if (this.failNext > 0) {
      this.failNext--;
      throw new Error("fake email provider: forced failure");
    }
    const id = `fake_${this.sent.length + 1}`;
    this.sent.push({ ...msg, id });
    return { id };
  }

  ofType(type: EmailType): (EmailMessage & { id: string })[] {
    return this.sent.filter((m) => m.type === type);
  }
}

const g = globalThis as unknown as { __ktiEmail?: EmailProvider | null };

export function getEmailProvider(): EmailProvider {
  if (g.__ktiEmail) return g.__ktiEmail;
  const key = process.env.RESEND_API_KEY;
  if (!key && process.env.NODE_ENV === "production") {
    console.error("[email] RESEND_API_KEY is not set: emails go to the local outbox and never reach anyone");
  }
  g.__ktiEmail = key ? new ResendEmailProvider(key) : new OutboxEmailProvider();
  return g.__ktiEmail;
}

/** Override the provider (tests). Pass null to go back to the environment's default. */
export function setEmailProvider(p: EmailProvider | null): void {
  g.__ktiEmail = p;
}
