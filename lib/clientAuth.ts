"use client";

/**
 * Browser-side helpers for the auth cookie.
 *
 * The cookie is intentionally readable by JS so the Redux store can rehydrate
 * on a hard navigation. Every one of these helpers is a no-op on the server.
 */

export const TOKEN_COOKIE = 'token';
const MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days, matches the JWT lifetime

export function getToken(): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie
    .split('; ')
    .find((row) => row.startsWith(`${TOKEN_COOKIE}=`));
  return match ? decodeURIComponent(match.slice(TOKEN_COOKIE.length + 1)) : null;
}

export function setToken(token: string): void {
  if (typeof document === 'undefined') return;
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${TOKEN_COOKIE}=${encodeURIComponent(
    token
  )}; path=/; max-age=${MAX_AGE_SECONDS}; SameSite=Lax${secure}`;
}

export function clearToken(): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${TOKEN_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
}

/** Authorization header for authenticated fetches, or `{}` when signed out. */
export function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Decodes the JWT payload without verifying it — for UI hints only. */
export function decodeToken(token: string): Record<string, unknown> | null {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const normalised = payload.replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(
      atob(normalised)
        .split('')
        .map((c) => `%${`00${c.charCodeAt(0).toString(16)}`.slice(-2)}`)
        .join('')
    );
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/**
 * Wrapper around fetch that attaches the bearer token and normalises errors so
 * callers get a useful message instead of "[object Object]".
 */
export async function apiFetch<T = unknown>(
  input: string,
  init: RequestInit = {}
): Promise<T> {
  const res = await fetch(input, {
    ...init,
    headers: {
      ...(init.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...authHeaders(),
      ...(init.headers as Record<string, string> | undefined),
    },
  });

  const text = await res.text();
  const data = text ? safeParse(text) : null;

  if (!res.ok) {
    const message =
      (data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
        ? data.error
        : null) ?? `Request failed (${res.status})`;
    throw new Error(message);
  }

  return data as T;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
