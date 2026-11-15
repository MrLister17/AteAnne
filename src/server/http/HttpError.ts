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

export class RateLimitedError extends HttpError {
  constructor() {
    super(429, "rate_limited", "Too many attempts. Please wait a few minutes and try again.");
  }
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
