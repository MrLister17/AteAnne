import { ConflictError, DomainError, PermissionError, ValidationError } from "@/domain/errors";

/** Errors that only make sense at the HTTP boundary. */
export class HttpError extends DomainError {
  constructor(
    public readonly status: number,
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(code, message, details);
  }
}

export class NotFoundError extends HttpError {
  constructor(message = "Not found") {
    super(404, "not_found", message);
  }
}

export class UnauthenticatedError extends HttpError {
  constructor() {
    super(401, "no_session", "Join or recover an event first");
  }
}

export class GoneError extends HttpError {
  constructor(code: string, message: string) {
    super(410, code, message);
  }
}

/** 429 with how long to wait; the route sends it as a Retry-After header too. */
export class RateLimitedError extends HttpError {
  readonly retryAfterSeconds: number;
  constructor(retryAfterSeconds = 60) {
    super(429, "rate_limited", `Too many tries, try again in ${waitWords(retryAfterSeconds)}`, { retryAfterSeconds });
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function waitWords(seconds: number): string {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

/** Map any domain error to an HTTP status code. */
export function statusFor(error: DomainError): number {
  if (error instanceof HttpError) return error.status;
  if (error instanceof ValidationError) return 400;
  if (error instanceof ConflictError) return 409;
  // Do not reveal whether a resource exists to someone without authority.
  if (error instanceof PermissionError) return 403;
  return 400;
}
