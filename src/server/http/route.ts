import { randomUUID, createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { DomainError } from "@/domain/errors";
import { config, configProblems } from "../config";
import { container, AppContainer } from "../container";
import { SESSION_COOKIE, SESSION_TTL_MS } from "../auth/SessionManager";
import { HttpError, UnauthenticatedError, statusFor } from "./HttpError";

const MAX_JSON_BYTES = 64 * 1024;

export interface RouteContext<P> {
  req: NextRequest;
  params: P;
  app: AppContainer;
  requestId: string;
  ipHash: string;
  /** Current actor or throws 401. */
  actor(): Promise<string>;
  /** Current actor, creating a new browser identity + session if needed. */
  actorOrCreate(): Promise<string>;
  json<T = unknown>(): Promise<T>;
}

type Handler<P> = (ctx: RouteContext<P>) => Promise<unknown>;

/** Serialise bigint as decimal strings (never lossy numbers). */
function serialize(value: unknown): string {
  return JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
}

export function privateHeaders(headers: Headers) {
  headers.set("Cache-Control", "private, no-store, max-age=0");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
}

/** Same-origin check for every state-changing request (CSRF defence with SameSite cookies). */
function assertSameOrigin(req: NextRequest) {
  if (req.method === "GET" || req.method === "HEAD") return;
  const origin = req.headers.get("origin");
  const allowed = new Set([config().APP_ORIGIN, req.nextUrl.origin]);
  // Behind a proxy (Vercel, preview tools) the public host arrives as X-Forwarded-Host.
  // Browsers cannot set this header cross-site without a CORS preflight we never grant.
  const fwdHost = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  if (fwdHost) allowed.add(`${req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || "https"}://${fwdHost}`);
  if (!origin || !allowed.has(origin)) throw new HttpError(403, "bad_origin", "Cross-site request blocked");
}

function clientIpHash(req: NextRequest): string {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
  return createHash("sha256").update(`ip:${ip}`).digest("hex").slice(0, 32);
}

/**
 * Wrap a route handler: origin/CSRF check, session resolution, size-limited
 * JSON parsing, domain-error → HTTP mapping, no-store private caching and a
 * safe request ID on unexpected errors. Logs never include bodies or secrets.
 */
export function route<P = Record<string, string>>(handler: Handler<P>) {
  return async (req: NextRequest, segment: { params: Promise<P> }) => {
    const requestId = randomUUID();
    let newSession: { token: string; expiresAt: Date } | null = null;
    try {
      if (configProblems().length) {
        throw new HttpError(503, "not_configured", "AteAnne isn't connected to its database yet, so nothing can be saved. Try again once setup is finished.");
      }
      assertSameOrigin(req);
      const app = container();
      const cookieToken = req.cookies.get(SESSION_COOKIE)?.value;
      let actorCache: string | null | undefined;
      const resolveActor = async () => {
        if (actorCache === undefined) actorCache = await app.sessions.resolve(cookieToken);
        return actorCache;
      };
      const ctx: RouteContext<P> = {
        req,
        params: (await segment?.params) ?? ({} as P),
        app,
        requestId,
        ipHash: clientIpHash(req),
        async actor() {
          const a = await resolveActor();
          if (!a) throw new UnauthenticatedError();
          return a;
        },
        async actorOrCreate() {
          const a = await resolveActor();
          if (a) return a;
          const issued = await app.sessions.issueForNewActor();
          newSession = issued;
          actorCache = issued.actorId;
          return issued.actorId;
        },
        async json<T>() {
          const type = req.headers.get("content-type") ?? "";
          if (!type.includes("application/json")) throw new HttpError(415, "json_required", "Send JSON");
          const text = await req.text();
          if (text.length > MAX_JSON_BYTES) throw new HttpError(413, "body_too_large", "Request is too large");
          try {
            return (text ? JSON.parse(text) : {}) as T;
          } catch {
            throw new HttpError(400, "bad_json", "Malformed JSON");
          }
        },
      };
      const result = await handler(ctx);
      const res = result instanceof Response ? (result as NextResponse) : new NextResponse(serialize(result ?? { ok: true }), { status: 200, headers: { "content-type": "application/json" } });
      privateHeaders(res.headers);
      if (newSession) setSessionCookie(res, newSession);
      return res;
    } catch (error) {
      const res = errorResponse(error, requestId);
      if (newSession) setSessionCookie(res, newSession);
      return res;
    }
  };
}

export function setSessionCookie(res: NextResponse, session: { token: string; expiresAt: Date }) {
  res.cookies.set(SESSION_COOKIE, session.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: config().secureCookies,
    path: "/",
    expires: session.expiresAt,
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

function errorResponse(error: unknown, requestId: string): NextResponse {
  let status = 500;
  let body: Record<string, unknown> = { error: { code: "internal", message: "Something went wrong. Please try again.", requestId } };
  if (error instanceof ZodError) {
    status = 400;
    body = { error: { code: "invalid_input", message: error.issues[0]?.message ?? "Invalid input", issues: error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) } };
  } else if (error instanceof DomainError) {
    status = statusFor(error);
    body = { error: { code: error.code, message: error.message, ...(error.details ?? {}) } };
  } else {
    // Redacted: no request body, cookies or stack traces with secrets reach the client.
    console.error(`[ateanne] ${requestId}`, error instanceof Error ? `${error.name}: ${error.message}` : "unknown error");
  }
  const res = new NextResponse(serialize(body), { status, headers: { "content-type": "application/json" } });
  privateHeaders(res.headers);
  return res;
}
