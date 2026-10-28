// OWNER: U. Live throne state: SSE `/api/thrones/{throne}/events` for every ThroneEvent, a refetch every
// 30 s and on tab focus (PRD "Real-time channel"), clock-skew correction from `serverNow`, and a 1 s tick.
"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { getApi, type ReservationAuth } from "@/lib/api-client";
import type { ThroneEvent, ThroneId, ThroneState } from "@/lib/contracts";
import { DAY_MS } from "@/lib/pricing";

export type ReservationResult = Extract<ThroneEvent, { type: "reservation.result" }>["data"];

export interface LiveCrown {
  /** Increments on every takeover that arrives live (never for the first state the page shows). */
  seq: number;
  kingId: string | null;
}

export interface UseThrone {
  state: ThroneState;
  /** Skew-corrected server time in ms, updated every second. */
  now: number;
  liveCrown: LiveCrown;
  connected: boolean;
  refetch: () => void;
}

const REFETCH_MS = 30_000;

export function useThrone(
  throne: ThroneId,
  initial: ThroneState,
  opts?: { reservation?: ReservationAuth | null; onReservationResult?: (r: ReservationResult) => void },
): UseThrone {
  const [state, setState] = useState(initial);
  const [now, setNow] = useState(() => Date.parse(initial.serverNow));
  const [liveCrown, setLiveCrown] = useState<LiveCrown>({ seq: 0, kingId: initial.king?.id ?? null });
  const [connected, setConnected] = useState(false);

  const offsetRef = useRef(0);
  const versionRef = useRef(initial.version);
  const kingRef = useRef(initial.king?.id ?? null);
  const primedRef = useRef(false);
  const resultRef = useRef(opts?.onReservationResult);
  useEffect(() => {
    resultRef.current = opts?.onReservationResult;
  });

  const accept = useCallback((s: ThroneState, fromStream: boolean) => {
    // The first state from the live channel replaces the server-rendered one unconditionally (it may come
    // from a different backend, e.g. the dev mock) and never animates.
    const first = fromStream && !primedRef.current;
    if (!first && s.version < versionRef.current) return;
    versionRef.current = s.version;
    offsetRef.current = Date.parse(s.serverNow) - Date.now();
    const kingId = s.king?.id ?? null;
    if (!first && primedRef.current && kingId && kingId !== kingRef.current) {
      setLiveCrown((c) => ({ seq: c.seq + 1, kingId }));
    }
    if (fromStream) primedRef.current = true;
    kingRef.current = kingId;
    setState(s);
    setNow(Date.now() + offsetRef.current);
  }, []);

  const refetch = useCallback(() => {
    void getApi()
      .then((api) => api.getThrone(throne))
      .then((r) => {
        if (r.ok) accept(r.data, false);
      });
  }, [throne, accept]);

  // 1 s clock.
  useEffect(() => {
    const tick = () => setNow(Date.now() + offsetRef.current);
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, []);

  // Live channel. Reconnects with the reservation's credentials while checkout is open so this browser
  // also receives its private reservation.result.
  const resId = opts?.reservation?.id ?? null;
  const resToken = opts?.reservation?.token ?? null;
  useEffect(() => {
    let close: (() => void) | null = null;
    let cancelled = false;
    void getApi().then((api) => {
      if (cancelled) return;
      close = api.subscribe(
        throne,
        (e) => {
          switch (e.type) {
            case "throne.updated":
              accept(e.data, true);
              break;
            case "reservation.updated":
              setState((s) => ({ ...s, reservation: e.data.lockedUntil ? { lockedUntil: e.data.lockedUntil } : null }));
              break;
            case "presence.count":
              setState((s) => ({ ...s, watching: e.data.watching }));
              break;
            case "reservation.result":
              resultRef.current?.(e.data);
              break;
          }
        },
        { reservation: resId && resToken ? { id: resId, token: resToken } : null, onStatus: setConnected },
      );
    });
    return () => {
      cancelled = true;
      close?.();
    };
  }, [throne, resId, resToken, accept]);

  // Refetch every 30 s and whenever the tab comes back.
  useEffect(() => {
    const id = setInterval(refetch, REFETCH_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") refetch();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [refetch]);

  // Price-relevant boundaries the server computes (daily reset at midnight UTC, eternal decay per idle day):
  // refetch right after crossing one instead of waiting for the next 30 s poll.
  const boundary = nextBoundary(state);
  const crossed = boundary != null && now >= boundary + 1500;
  useEffect(() => {
    if (crossed) refetch();
  }, [crossed, refetch]);

  return { state, now, liveCrown, connected, refetch };
}

function nextBoundary(s: ThroneState): number | null {
  if (s.throne === "daily") return s.resetsAt ? Date.parse(s.resetsAt) : null;
  if (!s.lastTakeoverAt) return null;
  return Date.parse(s.lastTakeoverAt) + (s.idleDays + 1) * DAY_MS;
}
