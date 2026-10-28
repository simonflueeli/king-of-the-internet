// OWNER: U. Dev-only in-browser simulation of the server API (reservations, fake payments, live events).
// Loaded only through getApi() in api-client.ts when the mock is enabled; never part of the production
// default path. The world lives in localStorage and syncs across tabs with a BroadcastChannel, so two
// tabs behave like two viewers. Pricing uses the same pure helpers as the server (src/lib/pricing.ts).
import type {
  ApiError,
  ConfirmReservationRequest,
  EndReason,
  FailReason,
  PublicConfig,
  ReignDTO,
  ReservationState,
  ReservationStatus,
  ThroneEvent,
  ThroneId,
  ThroneState,
  Title,
} from "./contracts";
import type { ApiResult, ReservationAuth, ThroneApi } from "./api-client";
import { normalizeText, textLength } from "./normalize";
import { DAY_MS, DEFAULT_PRICING, idleDays, minPriceCents, nextMinCents, nextUtcMidnight, titleFor } from "./pricing";

interface MockReign {
  id: string;
  throne: ThroneId;
  name: string;
  proclamation: string;
  paidCents: number;
  title: Title;
  startedAt: number;
  endedAt: number | null;
  endReason: EndReason | null;
  blurred: boolean;
}

interface MockThrone {
  version: number;
  currentReignId: string | null;
  lastPaidCents: number | null;
  crownedAt: number | null;
  removedAt: number | null;
}

interface MockReservation {
  id: string;
  token: string;
  throne: ThroneId;
  state: ReservationState;
  failReason: FailReason | null;
  minCents: number;
  amountCents: number | null;
  expiresAt: number;
  lastHeartbeat: number;
  version: number;
  reignId: string | null;
  name: string;
  proclamation: string;
  rival: boolean;
}

interface World {
  thrones: Record<ThroneId, MockThrone>;
  reigns: MockReign[];
  reservations: MockReservation[];
  nextCreate: "busy" | "rate_limited" | null;
}

export interface MockControls {
  rivalCheckout(throne: ThroneId): void;
  rivalRelease(throne: ThroneId): void;
  rivalTakeover(throne: ThroneId): void;
  removeKing(throne: ThroneId): void;
  dailyReset(): void;
  failNextReservation(kind: "busy" | "rate_limited"): void;
  reset(scenario?: string): void;
}

export type MockApi = ThroneApi & { controls: MockControls; scenario: string };

const STORE_KEY = "throne-mock-world-v1";
const RESERVATION_MS = 180_000;
const PAYING_MS = 600_000;
const RELEASE_SILENT_MS = 35_000;
const CFG = DEFAULT_PRICING;
const THRONES: ThroneId[] = ["eternal", "daily"];
const RIVALS = ["Ottokar", "Beatrix", "Kofi", "Ingrid", "Ramón", "Yuki", "Zelda", "Bartholomew the Bold"];

const LINK_RE = /https?:|www\.|\b[a-z0-9-]+\.(com|net|org|io|ch|de|co|xyz|ly|gg|app|me)\b|@[a-z0-9-]+\.[a-z]/i;

const uuid = () => crypto.randomUUID();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const latency = () => sleep(120 + Math.random() * 180);

function err(status: number, error: string, message: string, extra?: Record<string, unknown>): ApiResult<never> {
  return { ok: false, status, error: { error, message, ...extra } as ApiError };
}
function ok<T>(data: T, status = 200): ApiResult<T> {
  return { ok: true, status, data };
}

function utcDayStart(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function emptyThrone(): MockThrone {
  return { version: 0, currentReignId: null, lastPaidCents: null, crownedAt: null, removedAt: null };
}

function seedWorld(scenario: string): World {
  const world: World = {
    thrones: { eternal: emptyThrone(), daily: emptyThrone() },
    reigns: [],
    reservations: [],
    nextCreate: null,
  };
  if (scenario === "empty") return world;
  const now = Date.now();
  const crown = (throne: ThroneId, name: string, paidCents: number, startedAt: number, proclamation = "") => {
    const t = world.thrones[throne];
    const prev = world.reigns.find((r) => r.id === t.currentReignId);
    if (prev) {
      prev.endedAt = startedAt;
      prev.endReason = "takeover";
    }
    const reign: MockReign = {
      id: uuid(), throne, name, proclamation, paidCents, title: titleFor(paidCents),
      startedAt, endedAt: null, endReason: null, blurred: false,
    };
    world.reigns.push(reign);
    Object.assign(t, { version: t.version + 1, currentReignId: reign.id, lastPaidCents: paidCents, crownedAt: startedAt, removedAt: null });
  };
  const h = 3_600_000;
  crown("eternal", "Aurelia", 200, now - 30 * h, "First of my name.");
  crown("eternal", "Max", 220, now - 29.2 * h);
  crown("eternal", "Ottokar", 1500, now - 24 * h, "Bow, peasants.");
  crown("eternal", "Beatrix", 1650, now - 18.5 * h);
  crown("eternal", "Kofi", 1815, now - 13 * h, "Long may I reign.");
  crown("eternal", "Maximilian", 2000, now - 2.3 * h, "I paid for this and I regret nothing.");
  // Daily: yesterday's king only, so today starts vacant with "Yesterday's ruler".
  crown("daily", "Wilhelmina", 242, utcDayStart(now) - 3 * h, "Queen of yesterday.");
  return world;
}

function loadWorld(scenario: string): World {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const w = JSON.parse(raw) as World & { scenario?: string };
      if (w && w.thrones && Array.isArray(w.reigns) && w.scenario === scenario) return w;
    }
  } catch {
    // fall through to a fresh seed
  }
  return seedWorld(scenario);
}

function reignDTO(r: MockReign, now: number): ReignDTO {
  const end = r.endedAt ?? now;
  return {
    id: r.id, throne: r.throne, name: r.name, proclamation: r.proclamation || null, proclamationBlurred: r.blurred,
    paidCents: r.paidCents, title: r.title, startedAt: new Date(r.startedAt).toISOString(),
    endedAt: r.endedAt == null ? null : new Date(r.endedAt).toISOString(), endReason: r.endReason,
    lengthMs: Math.max(0, end - r.startedAt),
  };
}

export function createMockApi(scenario: string): MockApi {
  let world = loadWorld(scenario);
  const listeners = new Set<{ throne: ThroneId; reservationId: string | null; fn: (e: ThroneEvent) => void }>();
  const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("throne-mock") : null;

  const save = (changed: ThroneId[]) => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ ...world, scenario }));
    } catch {
      // storage full or blocked: the mock still works in memory
    }
    channel?.postMessage({ changed });
    emitThrones(changed);
  };

  channel?.addEventListener("message", (msg: MessageEvent<{ changed: ThroneId[] }>) => {
    world = loadWorld(scenario);
    emitThrones(msg.data.changed);
  });

  function stateOf(throne: ThroneId, now = Date.now()): ThroneState {
    const t = world.thrones[throne];
    const dayStart = utcDayStart(now);
    const all = world.reigns.filter((r) => r.throne === throne);
    const scope = throne === "daily" ? all.filter((r) => r.startedAt >= dayStart) : all;
    const current = all.find((r) => r.id === t.currentReignId) ?? null;
    const king = current && !(throne === "daily" && current.startedAt < dayStart) ? current : null;

    let vacancy: ThroneState["vacancy"] = null;
    if (!king) {
      if (throne === "daily") {
        const before = all.filter((r) => r.startedAt < dayStart).sort((a, b) => b.startedAt - a.startedAt)[0];
        const removedToday = t.removedAt != null && t.removedAt >= dayStart;
        if (removedToday) vacancy = { reason: "removed", yesterdayRuler: null };
        else if (before) vacancy = { reason: "reset", yesterdayRuler: before.startedAt >= dayStart - DAY_MS ? before.name : null };
        else vacancy = { reason: "never", yesterdayRuler: null };
      } else {
        vacancy = { reason: t.removedAt != null ? "removed" : "never", yesterdayRuler: null };
      }
    }

    const last = t.lastPaidCents != null && t.crownedAt != null ? { paidCents: t.lastPaidCents, crownedAt: new Date(t.crownedAt) } : null;
    const minCents = minPriceCents(throne, last, new Date(now), CFG);
    const visible = scope.filter((r) => !r.endReason || r.endReason !== "refunded");
    const lengthOf = (r: MockReign) => (r.endedAt ?? now) - r.startedAt;
    const longest = visible.reduce<MockReign | null>((b, r) => (!b || lengthOf(r) > lengthOf(b) ? r : b), null);
    const highest = visible.reduce<MockReign | null>((b, r) => (!b || r.paidCents > b.paidCents ? r : b), null);
    const lock = world.reservations.find((r) => r.throne === throne && (r.state === "active" || r.state === "paying") && r.expiresAt > now);
    const subs = [...listeners].filter((l) => l.throne === throne).length;

    return {
      throne,
      serverNow: new Date(now).toISOString(),
      version: t.version,
      king: king ? { ...reignDTO(king, now), crownedAt: new Date(king.startedAt).toISOString() } : null,
      vacancy,
      minCents,
      nextMinCentsAtMinimum: nextMinCents(minCents, CFG),
      idleDays: throne === "eternal" && t.crownedAt != null ? idleDays(new Date(t.crownedAt), new Date(now)) : 0,
      resetsAt: throne === "daily" ? nextUtcMidnight(new Date(now)).toISOString() : null,
      reservation: lock ? { lockedUntil: new Date(lock.expiresAt).toISOString() } : null,
      stats: {
        reignCount: scope.length,
        totalPaidCents: scope.reduce((s, r) => s + r.paidCents, 0),
        longest: longest ? reignDTO(longest, now) : null,
        highest: highest ? reignDTO(highest, now) : null,
      },
      recent: [...visible].sort((a, b) => b.startedAt - a.startedAt).slice(0, 12).map((r) => reignDTO(r, now)),
      lastTakeoverAt: t.crownedAt == null ? null : new Date(t.crownedAt).toISOString(),
      watching: subs + 2,
    };
  }

  function emitThrones(changed: ThroneId[]) {
    for (const throne of changed) {
      const state = stateOf(throne);
      for (const l of listeners) {
        if (l.throne !== throne) continue;
        l.fn({ type: "reservation.updated", data: { state: state.reservation ? "active" : null, lockedUntil: state.reservation?.lockedUntil ?? null } });
        l.fn({ type: "throne.updated", data: state });
      }
    }
  }

  function emitResult(r: MockReservation) {
    for (const l of listeners) {
      if (l.reservationId !== r.id) continue;
      l.fn({ type: "reservation.result", data: { reservationId: r.id, state: r.state, failReason: r.failReason, reignId: r.reignId } });
    }
  }

  function statusOf(r: MockReservation): ReservationStatus {
    return {
      id: r.id, throne: r.throne, state: r.state, failReason: r.failReason, expiresAt: new Date(r.expiresAt).toISOString(),
      minCents: r.minCents, amountCents: r.amountCents, reignId: r.reignId,
    };
  }

  function end(r: MockReservation, state: ReservationState, failReason: FailReason | null) {
    r.state = state;
    r.failReason = failReason;
    emitResult(r);
  }

  /** Expire overdue reservations and release silent ones (the server's "expire" job). */
  function sweep() {
    const now = Date.now();
    const changed = new Set<ThroneId>();
    for (const r of world.reservations) {
      if (r.state !== "active" && r.state !== "paying") continue;
      if (r.expiresAt <= now) {
        end(r, "expired", "expired");
        changed.add(r.throne);
      } else if (r.state === "active" && !r.rival && now - r.lastHeartbeat > RELEASE_SILENT_MS) {
        end(r, "released", "released");
        changed.add(r.throne);
      }
    }
    if (changed.size) save([...changed]);
  }
  setInterval(sweep, 1000);
  // Daily reset at midnight is handled lazily by stateOf(); re-emit once a minute so decay/reset show up.
  setInterval(() => emitThrones(THRONES), 60_000);

  function find(auth: ReservationAuth): MockReservation | null {
    const r = world.reservations.find((x) => x.id === auth.id);
    return r && r.token === auth.token ? r : null;
  }

  function crownNow(throne: ThroneId, name: string, proclamation: string, paidCents: number): MockReign {
    const now = Date.now();
    const t = world.thrones[throne];
    const prev = world.reigns.find((r) => r.id === t.currentReignId);
    if (prev && prev.endedAt == null) {
      prev.endedAt = now;
      prev.endReason = "takeover";
    }
    const reign: MockReign = {
      id: uuid(), throne, name, proclamation, paidCents, title: titleFor(paidCents),
      startedAt: now, endedAt: null, endReason: null, blurred: false,
    };
    world.reigns.push(reign);
    Object.assign(t, { version: t.version + 1, currentReignId: reign.id, lastPaidCents: paidCents, crownedAt: now, removedAt: null });
    return reign;
  }

  function openReservation(throne: ThroneId) {
    const now = Date.now();
    return world.reservations.find((r) => r.throne === throne && (r.state === "active" || r.state === "paying") && r.expiresAt > now);
  }

  function newReservation(throne: ThroneId, rival: boolean): MockReservation {
    const now = Date.now();
    const r: MockReservation = {
      id: uuid(), token: uuid(), throne, state: "active", failReason: null,
      minCents: stateOf(throne, now).minCents, amountCents: null, expiresAt: now + RESERVATION_MS,
      lastHeartbeat: now, version: world.thrones[throne].version, reignId: null, name: "", proclamation: "", rival,
    };
    world.reservations = world.reservations.filter((x) => x.state === "active" || x.state === "paying" || now - x.expiresAt < 3_600_000);
    world.reservations.push(r);
    return r;
  }

  const config: PublicConfig = {
    currency: "EUR",
    baseCents: CFG.baseCents, stepBps: CFG.stepBps, decayBps: CFG.decayBps, maxCents: CFG.maxCents,
    nameMax: 24, proclamationMax: 140, reservationMs: RESERVATION_MS, heartbeatMs: 20_000,
    paymentMode: "fake", stripePublishableKey: null,
  };

  const api: MockApi = {
    scenario,
    async getThrone(throne) {
      await latency();
      return ok(stateOf(throne));
    },
    async getPublicConfig() {
      await latency();
      return ok(config);
    },
    async createReservation(throne) {
      await latency();
      sweep();
      if (world.nextCreate === "rate_limited") {
        world.nextCreate = null;
        return err(429, "rate_limited", "Too many attempts. Try again in 10 minutes.");
      }
      const open = openReservation(throne);
      if (open || world.nextCreate === "busy") {
        world.nextCreate = null;
        const lockedUntil = new Date(open?.expiresAt ?? Date.now() + 60_000).toISOString();
        return err(409, "busy", "Someone else is paying for this throne right now.", { lockedUntil });
      }
      const r = newReservation(throne, false);
      save([throne]);
      return ok(
        {
          reservationId: r.id, reservationToken: r.token, clientSecret: `fake_${r.id}`, minCents: r.minCents,
          expiresAt: new Date(r.expiresAt).toISOString(), paymentMode: "fake",
        },
        201,
      );
    },
    async heartbeat(auth) {
      await latency();
      const r = find(auth);
      if (!r) return err(401, "unauthorized", "Bad reservation token.");
      if (r.state === "expired" || r.state === "released") return err(410, "expired", "Reservation expired.");
      r.lastHeartbeat = Date.now();
      save([]);
      return ok(statusOf(r));
    },
    async confirm(auth, body: ConfirmReservationRequest) {
      await sleep(400 + Math.random() * 400); // moderation takes a moment
      const r = find(auth);
      if (!r) return err(401, "unauthorized", "Bad reservation token.");
      if (r.state !== "active" && r.state !== "paying") return err(410, "expired", "Reservation expired.");
      if (r.expiresAt <= Date.now()) return err(410, "expired", "Reservation expired.");
      if (!Number.isSafeInteger(body.amountCents) || body.amountCents < r.minCents || body.amountCents > CFG.maxCents) {
        return err(422, "amount", "Amount out of range.");
      }
      const name = normalizeText(body.name);
      const proclamation = normalizeText(body.proclamation);
      if (textLength(name) < 1 || textLength(name) > 24) {
        return err(422, "validation", "Names need 1 to 24 characters.", { field: "name" });
      }
      if (textLength(proclamation) > 140) {
        return err(422, "validation", "Proclamations can have at most 140 characters.", { field: "proclamation" });
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
        return err(422, "validation", "Enter a valid email address.", { field: "email" });
      }
      if (!body.termsAccepted) return err(422, "validation", "Accept the Terms to continue.", { field: "terms" });
      if (/#503/.test(name + proclamation)) {
        return err(503, "moderation_unavailable", "We can’t check names right now. Try again in a few minutes.");
      }
      for (const [field, text] of [["name", name], ["proclamation", proclamation]] as const) {
        if (LINK_RE.test(text)) {
          return err(422, "moderation", "Links and contact details aren’t allowed on the throne. Remove them and try again.", {
            field, category: "links",
          });
        }
      }
      Object.assign(r, {
        state: "paying", failReason: null, amountCents: body.amountCents, name, proclamation,
        expiresAt: Math.min(Date.now() + PAYING_MS, r.expiresAt + PAYING_MS),
      });
      save([r.throne]);
      return ok(statusOf(r));
    },
    async getReservation(auth) {
      await latency();
      const r = find(auth);
      if (!r) return err(404, "not_found", "Unknown reservation.");
      return ok(statusOf(r));
    },
    async cancelReservation(auth) {
      await latency();
      const r = find(auth);
      // Releases an open reservation, also a "paying" one whose card was declined (nothing authorized).
      if (r && (r.state === "active" || (r.state === "paying" && r.failReason === "card_declined"))) {
        end(r, "released", "released");
        save([r.throne]);
      }
      return ok(null, 204);
    },
    async fakePay(auth, outcome) {
      await latency();
      const r = find(auth);
      if (!r) return err(401, "unauthorized", "Bad reservation token.");
      if (r.state !== "paying") return err(409, "not_paying", "Confirm the reservation first.");
      if (outcome === "decline") {
        // Declines leave the reservation open until it expires, so the buyer can try another card.
        r.failReason = "card_declined";
        save([]);
        return ok(statusOf(r));
      }
      setTimeout(() => {
        // The "webhook": capture and crown only if the reservation is still valid.
        const t = world.thrones[r.throne];
        if (r.state !== "paying") return;
        if (r.expiresAt <= Date.now() || t.version !== r.version) {
          end(r, "failed", "outbid");
          save([r.throne]);
          return;
        }
        const reign = crownNow(r.throne, r.name, r.proclamation, r.amountCents ?? r.minCents);
        r.reignId = reign.id;
        end(r, "completed", null);
        save([r.throne]);
      }, 900);
      return ok(statusOf(r));
    },
    async report() {
      await latency();
      return ok(null, 201);
    },
    subscribe(throne, onEvent, opts) {
      const entry = { throne, reservationId: opts?.reservation?.id ?? null, fn: onEvent };
      listeners.add(entry);
      const timer = setTimeout(() => {
        opts?.onStatus?.(true);
        onEvent({ type: "throne.updated", data: stateOf(throne) });
        presence(throne);
      }, 50);
      return () => {
        clearTimeout(timer);
        listeners.delete(entry);
        presence(throne);
      };
    },
    controls: {
      rivalCheckout(throne) {
        sweep();
        if (openReservation(throne)) return;
        newReservation(throne, true);
        save([throne]);
      },
      rivalRelease(throne) {
        const r = world.reservations.find((x) => x.throne === throne && x.rival && (x.state === "active" || x.state === "paying"));
        if (!r) return;
        r.state = "released";
        save([throne]);
      },
      rivalTakeover(throne) {
        const min = stateOf(throne).minCents;
        const name = RIVALS[Math.floor(Math.random() * RIVALS.length)];
        const amount = Math.random() < 0.3 ? min * 2 : min;
        crownNow(throne, name, Math.random() < 0.5 ? "The throne is mine now." : "", amount);
        save([throne]);
      },
      removeKing(throne) {
        const t = world.thrones[throne];
        const reign = world.reigns.find((r) => r.id === t.currentReignId);
        if (!reign || reign.endedAt != null) return;
        reign.endedAt = Date.now();
        reign.endReason = "removed";
        Object.assign(t, { version: t.version + 1, currentReignId: null, removedAt: Date.now() });
        save([throne]);
      },
      dailyReset() {
        // Pretend midnight just passed: move every daily reign one day into the past.
        for (const r of world.reigns) {
          if (r.throne !== "daily") continue;
          r.startedAt -= DAY_MS;
          if (r.endedAt != null) r.endedAt -= DAY_MS;
        }
        const t = world.thrones.daily;
        const cur = world.reigns.find((r) => r.id === t.currentReignId);
        if (cur && cur.endedAt == null) {
          cur.endedAt = utcDayStart(Date.now());
          cur.endReason = "reset";
        }
        if (t.crownedAt != null) t.crownedAt -= DAY_MS;
        t.removedAt = null;
        t.version += 1;
        save(["daily"]);
      },
      failNextReservation(kind) {
        world.nextCreate = kind;
      },
      reset(next) {
        const old = world;
        world = seedWorld(next ?? scenario);
        // Versions only ever go up (clients drop older states).
        for (const t of THRONES) world.thrones[t].version += old.thrones[t].version + 1;
        save(THRONES);
      },
    },
  };

  function presence(throne: ThroneId) {
    const watching = [...listeners].filter((l) => l.throne === throne).length + 2;
    for (const l of listeners) if (l.throne === throne) l.fn({ type: "presence.count", data: { watching } });
  }

  return api;
}
