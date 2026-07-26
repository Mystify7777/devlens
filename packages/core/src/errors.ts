/**
 * Thrown when an operation is attempted on an EventBus after destroy()
 * has been called. A destroyed bus fails loudly rather than silently
 * dropping events, so a plugin holding a stale reference doesn't fail quietly.
 */
export class EventBusDestroyedError extends Error {
  constructor(action: string = "report") {
    super(`Cannot ${action} on a destroyed EventBus`);
    this.name = "EventBusDestroyedError";
  }
}

/**
 * Thrown when an EventMiddleware misbehaves — currently, when it calls
 * next() more than once for the same event.
 */
export class MiddlewareError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MiddlewareError";
  }
}