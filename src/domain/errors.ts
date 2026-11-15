/**
 * Domain error hierarchy. Every rule violation in the pure domain layer is a
 * DomainError with a stable machine-readable `code`; the HTTP layer maps the
 * subclass to a status code without the domain knowing about HTTP.
 */
export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** Input is malformed or outside documented bounds (HTTP 400). */
export class ValidationError extends DomainError {}

/** The action conflicts with current state, versions or capacity (HTTP 409). */
export class ConflictError extends DomainError {}

/** The actor is authenticated but lacks authority for this action (HTTP 403/404). */
export class PermissionError extends DomainError {}
