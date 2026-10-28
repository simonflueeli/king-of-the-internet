// OWNER: U. Reign ids this browser created, for "That’s you." (FR-03) and "Crown yourself again" (FR-10).
// Kept in localStorage only; every access is wrapped because storage can be blocked or full.
"use client";
import { useCallback, useMemo, useSyncExternalStore } from "react";

const KEY = "throne-my-reigns-v1";
const EVENT = "throne-my-reigns";
const MAX = 200;

function read(): string {
  try {
    return localStorage.getItem(KEY) ?? "[]";
  } catch {
    return "[]";
  }
}

function subscribe(cb: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) cb();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(EVENT, cb);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(EVENT, cb);
  };
}

function parse(raw: string): string[] {
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function addMyReign(id: string): void {
  const ids = parse(read()).filter((x) => x !== id);
  ids.push(id);
  try {
    localStorage.setItem(KEY, JSON.stringify(ids.slice(-MAX)));
  } catch {
    // blocked storage: "That's you." just won't show
  }
  window.dispatchEvent(new Event(EVENT));
}

export function useMyReigns(): { isMine: (id: string | null | undefined) => boolean; add: (id: string) => void } {
  const raw = useSyncExternalStore(subscribe, read, () => "[]");
  const set = useMemo(() => new Set(parse(raw)), [raw]);
  const isMine = useCallback((id: string | null | undefined) => !!id && set.has(id), [set]);
  return { isMine, add: addMyReign };
}
