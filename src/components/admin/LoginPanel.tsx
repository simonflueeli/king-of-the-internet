"use client";
// OWNER: S. Admin sign-in: passkey login, first-passkey registration with the bootstrap token,
// and the localhost-only development login.
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { copy } from "@/lib/copy";
import { adminFetch } from "./client";
import s from "./admin.module.css";

const t = copy.safety.admin;

export function LoginPanel({ devLogin }: { devLogin: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");

  const done = () => {
    router.push("/admin");
    router.refresh();
  };

  async function attempt(fn: () => Promise<string | null>) {
    setBusy(true);
    setError(null);
    try {
      const err = await fn();
      if (err) setError(err);
      else done();
    } catch (e) {
      // NotAllowedError = the person cancelled or the browser timed out.
      setError(e instanceof Error && e.name === "NotAllowedError" ? null : t.passkeyFailed);
    } finally {
      setBusy(false);
    }
  }

  const login = () =>
    attempt(async () => {
      const opts = await adminFetch<PublicKeyCredentialRequestOptionsJSON>("/api/admin/auth/login/options");
      if (!opts.ok) return opts.message;
      const response = await startAuthentication({ optionsJSON: opts.data });
      const verify = await adminFetch("/api/admin/auth/login/verify", "POST", response);
      return verify.ok ? null : verify.message;
    });

  const register = () =>
    attempt(async () => {
      const opts = await adminFetch<PublicKeyCredentialCreationOptionsJSON>("/api/admin/auth/register/options", "POST", {
        email,
        bootstrapToken: token,
      });
      if (!opts.ok) return opts.message;
      const response = await startRegistration({ optionsJSON: opts.data });
      const verify = await adminFetch("/api/admin/auth/register/verify", "POST", response);
      return verify.ok ? null : verify.message;
    });

  const dev = () =>
    attempt(async () => {
      const r = await adminFetch("/api/admin/auth/dev-login");
      return r.ok ? null : r.message;
    });

  return (
    <div className={s.card}>
      <h1 className={s.h2}>{t.title}</h1>
      <div className={s.form}>
        <button type="button" className={s.primary} disabled={busy} onClick={login}>
          {t.signIn}
        </button>
        {devLogin && (
          <button type="button" className={s.button} disabled={busy} onClick={dev}>
            {t.devLogin}
          </button>
        )}
        {error && (
          <p role="alert" className={s.error}>
            {error}
          </p>
        )}
      </div>
      <hr className={s.divider} />
      <form
        className={s.form}
        onSubmit={(e) => {
          e.preventDefault();
          void register();
        }}
      >
        <p className={`${s.muted} ${s.small}`} style={{ margin: 0 }}>
          {t.registerHint}
        </p>
        <label className={s.label}>
          Admin email
          <input
            className={s.input}
            type="email"
            autoComplete="username webauthn"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className={s.label}>
          Bootstrap token
          <input className={s.input} type="password" value={token} onChange={(e) => setToken(e.target.value)} />
        </label>
        <button type="submit" className={s.button} disabled={busy}>
          {t.register}
        </button>
      </form>
    </div>
  );
}
