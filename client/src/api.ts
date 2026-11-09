import { useState } from 'react';
import { BUILD_HEADER, BUILD_ID } from '../../shared/build';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export type Outdated = 'server' | 'page';

/**
 * Tells the app when this page and the server come from different builds: the server was
 * left running across an update, or the page was left open across a restart.
 */
function checkBuild(serverBuild: string | null): void {
  if (BUILD_ID === 'dev' || serverBuild === 'dev' || serverBuild === BUILD_ID) return;
  // Servers from before this check send no id at all, so a missing id also means an old server.
  const outdated: Outdated = serverBuild == null || Number(serverBuild) < Number(BUILD_ID) ? 'server' : 'page';
  window.dispatchEvent(new CustomEvent<Outdated>('bm-outdated', { detail: outdated }));
}

export async function api<T = void>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch('/api' + url, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'bm' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  checkBuild(res.headers.get(BUILD_HEADER));
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    // Session expired or the account was disabled: send the app back to the sign-in screen.
    if (res.status === 401 && !url.startsWith('/auth/')) window.dispatchEvent(new Event('bm-signed-out'));
    throw new ApiError(data?.error ?? `Request failed (${res.status})`, res.status);
  }
  return data as T;
}

/** Tracks the busy and error state of a form submission or button action. */
export function useAction() {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function run(fn: () => Promise<unknown>): Promise<boolean> {
    setBusy(true);
    setError('');
    try {
      await fn();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { error, busy, run };
}
