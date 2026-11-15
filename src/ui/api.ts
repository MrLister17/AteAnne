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

/** Small typed client: JSON in/out, same-origin cookies, no caching. */
export class ApiClient {
  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(path, {
        method,
        credentials: "same-origin",
        cache: "no-store",
        headers: body instanceof FormData ? undefined : body !== undefined ? { "content-type": "application/json" } : undefined,
        body: body instanceof FormData ? body : body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new ApiError(0, "offline", "You seem to be offline. Nothing was saved — try again when connected.");
    }
    const text = await res.text();
    const data = text ? JSON.parse(text) : {};
    if (!res.ok) {
      const e = data?.error ?? {};
      throw new ApiError(res.status, e.code ?? "error", e.message ?? "Something went wrong", e);
    }
    return data as T;
  }
  get<T>(path: string) {
    return this.request<T>("GET", path);
  }
  post<T>(path: string, body: unknown = {}) {
    return this.request<T>("POST", path, body);
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
