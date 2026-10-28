// OWNER: U. Browser client for the public HTTP/SSE API (docs/ARCHITECTURE.md "HTTP API"), typed by
// contracts.ts. In development, `?mock=1` (sticky for the tab) or NEXT_PUBLIC_MOCK_API=1 routes every call
// to an in-browser simulation (api-mock.ts) so the whole UI flow works without the server API.
// The mock is only reachable when MOCK_ALLOWED is true, which is statically false in a production build
// unless NEXT_PUBLIC_MOCK_API=1 was set at build time, so the bundler drops the import.
import type {
  ApiError,
  ConfirmReservationRequest,
  CreateReservationResponse,
  PublicConfig,
  ReservationStatus,
  ThroneEvent,
  ThroneId,
  ThroneState,
} from "./contracts";

export type ApiResult<T> = { ok: true; status: number; data: T } | { ok: false; status: number; error: ApiError };

export type ReservationSource = "button" | "tryon" | "reclaim";
export type ReportReason = "offensive" | "impersonation" | "spam" | "other";

export interface ReservationAuth {
  id: string;
  token: string;
}

/** Everything the UI needs from the server. The real implementation and the mock both satisfy it. */
export interface ThroneApi {
  getThrone(throne: ThroneId): Promise<ApiResult<ThroneState>>;
  getPublicConfig(): Promise<ApiResult<PublicConfig>>;
  createReservation(throne: ThroneId, source: ReservationSource): Promise<ApiResult<CreateReservationResponse>>;
  heartbeat(r: ReservationAuth): Promise<ApiResult<ReservationStatus>>;
  confirm(r: ReservationAuth, body: ConfirmReservationRequest): Promise<ApiResult<ReservationStatus>>;
  getReservation(r: ReservationAuth): Promise<ApiResult<ReservationStatus>>;
  cancelReservation(r: ReservationAuth, opts?: { keepalive?: boolean }): Promise<ApiResult<null>>;
  fakePay(r: ReservationAuth, outcome: "succeed" | "decline"): Promise<ApiResult<ReservationStatus>>;
  report(body: { reignId: string; reason: ReportReason; details?: string }): Promise<ApiResult<null>>;
  /** Opens the throne's live channel. Returns a function that closes it. */
  subscribe(
    throne: ThroneId,
    onEvent: (e: ThroneEvent) => void,
    opts?: { reservation?: ReservationAuth | null; onStatus?: (connected: boolean) => void },
  ): () => void;
}

const EVENT_TYPES: ThroneEvent["type"][] = ["throne.updated", "reservation.updated", "presence.count", "reservation.result"];

function networkError(): ApiError {
  return { error: "network", message: "Network error" };
}

async function request<T>(method: string, path: string, init?: { body?: unknown; token?: string; keepalive?: boolean }): Promise<ApiResult<T>> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (init?.body !== undefined) headers["Content-Type"] = "application/json";
  if (init?.token) headers["X-Reservation-Token"] = init.token;
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers,
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
      cache: "no-store",
      credentials: "same-origin",
      keepalive: init?.keepalive,
    });
  } catch {
    return { ok: false, status: 0, error: networkError() };
  }
  let payload: unknown = null;
  if (res.status !== 204) {
    try {
      payload = await res.json();
    } catch {
      payload = null;
    }
  }
  if (res.ok) return { ok: true, status: res.status, data: payload as T };
  const error =
    payload && typeof payload === "object" && "error" in payload
      ? (payload as ApiError)
      : { error: `http_${res.status}`, message: res.statusText || "Request failed" };
  return { ok: false, status: res.status, error };
}

const enc = encodeURIComponent;

export const httpApi: ThroneApi = {
  getThrone: (throne) => request("GET", `/api/thrones/${throne}`),
  getPublicConfig: () => request("GET", "/api/config/public"),
  createReservation: (throne, source) => request("POST", `/api/thrones/${throne}/reservations`, { body: { source } }),
  heartbeat: (r) => request("POST", `/api/reservations/${enc(r.id)}/heartbeat`, { token: r.token }),
  confirm: (r, body) => request("POST", `/api/reservations/${enc(r.id)}/confirm`, { token: r.token, body }),
  getReservation: (r) => request("GET", `/api/reservations/${enc(r.id)}`, { token: r.token }),
  cancelReservation: (r, opts) =>
    request("DELETE", `/api/reservations/${enc(r.id)}`, { token: r.token, keepalive: opts?.keepalive }),
  fakePay: (r, outcome) => request("POST", `/api/dev/fake-pay/${enc(r.id)}`, { token: r.token, body: { outcome } }),
  report: (body) => request("POST", "/api/reports", { body }),
  subscribe(throne, onEvent, opts) {
    if (typeof EventSource === "undefined") return () => {};
    const params = new URLSearchParams();
    if (opts?.reservation) {
      params.set("reservationId", opts.reservation.id);
      params.set("token", opts.reservation.token);
    }
    const qs = params.toString();
    const url = `/api/thrones/${throne}/events${qs ? `?${qs}` : ""}`;
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    const open = () => {
      if (closed) return;
      es = new EventSource(url);
      es.onopen = () => opts?.onStatus?.(true);
      es.onerror = () => {
        opts?.onStatus?.(false);
        // The browser reconnects by itself unless the server answered with an error status.
        if (es && es.readyState === EventSource.CLOSED) {
          es = null;
          retry = setTimeout(open, 5000);
        }
      };
      for (const type of EVENT_TYPES) {
        es.addEventListener(type, (msg) => {
          try {
            onEvent({ type, data: JSON.parse((msg as MessageEvent<string>).data) } as ThroneEvent);
          } catch {
            // ignore malformed frames
          }
        });
      }
    };
    open();
    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      es?.close();
    };
  },
};

// ---------------------------------------------------------------------------------------------
// Mock switch (dev only)

export const MOCK_ALLOWED = process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_MOCK_API === "1";
const MOCK_KEY = "throne-mock";

/** The mock scenario for this tab ("1", "empty", …) or null. Reads `?mock=` and remembers it per tab. */
export function mockScenario(): string | null {
  if (!MOCK_ALLOWED || typeof window === "undefined") return null;
  if (process.env.NEXT_PUBLIC_MOCK_API === "1") return "1";
  const param = new URLSearchParams(window.location.search).get("mock");
  try {
    if (param === "0") sessionStorage.removeItem(MOCK_KEY);
    else if (param) sessionStorage.setItem(MOCK_KEY, param);
    return param === "0" ? null : (param ?? sessionStorage.getItem(MOCK_KEY));
  } catch {
    return param && param !== "0" ? param : null;
  }
}

let apiPromise: Promise<ThroneApi> | null = null;

/** The API to use in this tab: the mock when enabled, the real HTTP API otherwise. */
export function getApi(): Promise<ThroneApi> {
  if (!apiPromise) {
    const scenario = mockScenario();
    if (MOCK_ALLOWED && scenario) {
      apiPromise = import("./api-mock").then((m) => m.createMockApi(scenario));
    } else {
      apiPromise = Promise.resolve(httpApi);
    }
  }
  return apiPromise;
}
