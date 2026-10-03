/**
 * Errors the HTTP layer knows how to turn into a response. Anything else
 * thrown is a bug or an outage and is deliberately NOT caught here — it
 * surfaces as a 500 and shows up in Application Insights.
 */
export class HttpError extends Error {
  readonly status: number
  readonly details: Record<string, unknown>

  constructor(status: number, message: string, details: Record<string, unknown> = {}) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.details = details
  }
}

/** 400 — the request itself is malformed (bad JSON, wrong shape, bad code). */
export class BadRequestError extends HttpError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super(400, message, details)
    this.name = 'BadRequestError'
  }
}

/** 404 — also used when a game exists but the caller isn't seated in it, so ids can't be probed. */
export class NotFoundError extends HttpError {
  constructor(message: string) {
    super(404, message)
    this.name = 'NotFoundError'
  }
}

/** 409 — the request was fine but the game's state says no (stale version, full, not started, over). */
export class ConflictError extends HttpError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super(409, message, details)
    this.name = 'ConflictError'
  }
}

/** 422 — well-formed, but the rules forbid it. The message is the engine's own explanation. */
export class IllegalMoveError extends HttpError {
  constructor(message: string) {
    super(422, message)
    this.name = 'IllegalMoveError'
  }
}
