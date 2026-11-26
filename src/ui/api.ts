"use client";

/** Error returned by the Hatian API, with machine code and optional gate blockers. */
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
  if (status === 413) return "That photo is too large to upload, so try a smaller photo or a screenshot of it";
  if (status === 504 || status === 408) return "That took too long, so check your connection and try again";
  if (status === 429) return "Too many tries in a short time, so wait a minute and try again";
  if (status >= 500) return "The server had a problem and nothing was changed, so try again in a moment";
  return "Something went wrong";
}

/** Must match ACT_AS_HEADER on the server. */
const ACT_AS_HEADER = "x-ateanne-act-as";

/** Small typed client: JSON in/out, same-origin cookies, no caching. */
export class ApiClient {
  /**
   * While the organizer or an admin is acting for a guest (someone without a
   * phone), every request says so. The server checks it is allowed, and
   * refuses it on anything that isn't one of the guest's own actions.
   */
  private actingAs: string | null = null;

  setActingAs(memberId: string | null) {
    this.actingAs = memberId;
  }

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
          headers: {
            ...(body !== undefined && !(body instanceof FormData) ? { "content-type": "application/json" } : {}),
            ...(this.actingAs ? { [ACT_AS_HEADER]: this.actingAs } : {}),
          },
          body: body instanceof FormData ? body : body !== undefined ? JSON.stringify(body) : undefined,
        });
      } catch {
        if (opts.signal?.aborted) throw new ApiError(0, "aborted", "Stopped");
        throw new ApiError(0, "offline", "You seem to be offline and nothing was saved, so try again when connected");
      }
      const text = await res.text();
      let data: Record<string, unknown> & { error?: { code?: string; message?: string } } = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        if (res.ok) throw new ApiError(res.status, "bad_response", "The server sent an unexpected reply, so try again");
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
