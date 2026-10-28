"use client";
// OWNER: S. Small client building blocks for the admin console: fetch helper, action buttons,
// auto refresh, nav, sign out.
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import s from "./admin.module.css";

export async function adminFetch<T = unknown>(
  path: string,
  method: "GET" | "POST" | "PATCH" | "DELETE" = "POST",
  body?: unknown,
): Promise<{ ok: true; data: T } | { ok: false; status: number; message: string }> {
  try {
    const res = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, status: res.status, message: data?.message ?? `Request failed (${res.status}).` };
    return { ok: true, data: data as T };
  } catch {
    return { ok: false, status: 0, message: "Network error. Try again." };
  }
}

/** Runs an admin API call, shows its error, refreshes the server-rendered page on success. */
export function useAdminAction() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run<T>(path: string, method: "POST" | "PATCH" | "DELETE", body?: unknown): Promise<T | null> {
    setBusy(true);
    setError(null);
    const r = await adminFetch<T>(path, method, body);
    setBusy(false);
    if (!r.ok) {
      if (r.status === 401) router.push("/admin/login");
      setError(r.message);
      return null;
    }
    startTransition(() => router.refresh());
    return r.data;
  }
  return { run, busy: busy || pending, error };
}

export function ActionButton(props: {
  path: string;
  method?: "POST" | "DELETE";
  body?: unknown;
  label: string;
  confirm?: string;
  variant?: "button" | "danger" | "primary";
}) {
  const { run, busy, error } = useAdminAction();
  return (
    <span className={s.row}>
      <button
        type="button"
        className={s[props.variant ?? "button"]}
        disabled={busy}
        onClick={() => {
          if (props.confirm && !window.confirm(props.confirm)) return;
          void run(props.path, props.method ?? "POST", props.body);
        }}
      >
        {props.label}
      </button>
      {error && (
        <span role="alert" className={s.error}>
          {error}
        </span>
      )}
    </span>
  );
}

/** Re-renders the server component tree every `seconds` while the tab is visible (AD-01 live view). */
export function AutoRefresh({ seconds = 5 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, seconds * 1000);
    return () => clearInterval(id);
  }, [router, seconds]);
  return null;
}

const NAV = [
  { href: "/admin", label: "Thrones" },
  { href: "/admin/reports", label: "Reports" },
  { href: "/admin/payments", label: "Payments" },
  { href: "/admin/bans", label: "Bans" },
  { href: "/admin/terms", label: "Banned terms" },
  { href: "/admin/config", label: "Config" },
  { href: "/admin/revenue", label: "Revenue" },
  { href: "/admin/audit", label: "Audit log" },
];

export function AdminNav({ pendingReports }: { pendingReports: number }) {
  const pathname = usePathname();
  return (
    <nav className={s.nav} aria-label="Admin">
      {NAV.map((n) => (
        <Link key={n.href} href={n.href} className={s.navLink} aria-current={pathname === n.href ? "page" : undefined}>
          {n.label}
          {n.href === "/admin/reports" && pendingReports > 0 ? (
            <>
              {" "}
              <span className={s.badgeWarn}>{pendingReports}</span>
            </>
          ) : null}
        </Link>
      ))}
    </nav>
  );
}

export function SignOutButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      className={s.button}
      onClick={async () => {
        await adminFetch("/api/admin/auth/logout", "POST");
        router.push("/admin/login");
        router.refresh();
      }}
    >
      Sign out
    </button>
  );
}
