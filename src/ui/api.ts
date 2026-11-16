"use client";

/** Error returned by the AteAnne API, with machine code and optional gate blockers. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly data: Record<string, unknown> = {},
  ) {
    super(message);
  }
  get blockers(): string[] {
    return Array.isArray(this.data.blockers) ? (this.data.blockers as string[]) : [];
  }
}

/** How many requests are in flight; drives the thin "working…" bar so every tap shows it was received. */
let inFlight = 0;
const listeners = new Set<(busy: boolean) => void>();
function track(delta: number) {
  inFlight = Math.max(0, inFlight + delta);
  for (const l of listeners) l(inFlight > 0);
}
export function onActivity(listener: (busy: boolean) => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** Hosting platforms answer some failures with plain text/HTML instead of our JSON; give those a human message. */
function fallbackMessage(status: number): string {
  if (status === 413) return "That photo is too large to upload. Try a smaller photo or a screenshot of it.";
  if (status === 504 || status === 408) return "That took too long. Check your connection and try again.";
  if (status === 429) return "Too many tries in a short time. Wait a minute and try again.";
  if (status >= 500) return "The server had a problem. Nothing was changed — try again in a moment.";
  return "Something went wrong";
}

/** Small typed client: JSON in/out, same-origin cookies, no caching. */
export class ApiClient {
  async request<T>(method: string, path: string, body?: unknown, opts: { signal?: AbortSignal; quiet?: boolean } = {}): Promise<T> {
    let res: Response;
    if (!opts.quiet) track(1);
    try {
      try {
        res = await fetch(path, {
          method,
          credentials: "same-origin",
          cache: "no-store",
          signal: opts.signal,
          headers: body instanceof FormData ? undefined : body !== undefined ? { "content-type": "application/json" } : undefined,
          body: body instanceof FormData ? body : body !== undefined ? JSON.stringify(body) : undefined,
        });
      } catch {
        if (opts.signal?.aborted) throw new ApiError(0, "aborted", "Stopped.");
        throw new ApiError(0, "offline", "You seem to be offline. Nothing was saved — try again when connected.");
      }
      const text = await res.text();
      let data: Record<string, unknown> & { error?: { code?: string; message?: string } } = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        if (res.ok) throw new ApiError(res.status, "bad_response", "The server sent an unexpected reply. Try again.");
      }
      if (!res.ok) {
        const e = data?.error ?? {};
        throw new ApiError(res.status, e.code ?? "error", e.message ?? fallbackMessage(res.status), e);
      }
      return data as T;
    } finally {
      if (!opts.quiet) track(-1);
    }
  }
  get<T>(path: string) {
    return this.request<T>("GET", path, undefined, { quiet: true }); // background refreshes don't flash the activity bar
  }
  post<T>(path: string, body: unknown = {}, opts?: { signal?: AbortSignal }) {
    return this.request<T>("POST", path, body, opts);
  }
  put<T>(path: string, body: unknown) {
    return this.request<T>("PUT", path, body);
  }
  patch<T>(path: string, body: unknown) {
    return this.request<T>("PATCH", path, body);
  }
  del<T>(path: string, body: unknown = {}) {
    return this.request<T>("DELETE", path, body);
  }
}

export const api = new ApiClient();

/** Stable per-attempt idempotency key (reused if the user retries the same submission). */
export function newIdempotencyKey(): string {
  return (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`).replace(/[^A-Za-z0-9_-]/g, "");
}
