/**
 * Severity of a DevLens event. Used for filtering, coloring, and sort order
 * in the panel UI. Closed union — unlike EventCategory, severity is a UI
 * contract that renderers switch on, so it shouldn't be extensible by plugins.
 */
export type EventSeverity = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

/** Categories with first-class support (autocomplete, known icons/colors). */
export type BuiltinEventCategory =
  | "runtime"
  | "console"
  | "network"
  | "compiler"
  | "framework"
  | "performance";


/**
 * Hybrid literal-union type: builtin categories get autocomplete, but
 * third-party plugins can report any string category without needing
 * changes to @devlens/core.
 */
export type EventCategory = BuiltinEventCategory | (string & {});


/**
 * Represents one normalized event emitted anywhere within a
 * DevLens-enabled application. Fields are readonly — once an event has
 * been published by the Event Bus, it is frozen and should be treated
 * as immutable by every consumer (subscribers, Store, Panel).
 */
export interface DevLensEvent {
  readonly id: string;  /** Unique event ID. Assigned by the Event Bus if not provided. */
  readonly version: 1;  /** Schema version of this event shape. Assigned by the Event Bus if not provided. */
  readonly origin: string;  /** Where this event came from, e.g. "window.onerror", "vite", "plugin:apollo". */
  readonly category: EventCategory;
  readonly severity: EventSeverity;
  readonly title: string;
  readonly message: string;
  readonly timestamp: number;  /** Assigned by the Event Bus if not provided. */
  readonly stack?: string;
  readonly metadata?: Record<string, unknown>;  /** Data describing the event itself, e.g. { duration, status }. */
  readonly context?: Record<string, unknown>;  /** Data describing the environment the event occurred in, e.g. { route, viewport }. */
  readonly tags?: string[];  /** Free-form labels for search/filtering, e.g. ["react", "auth", "critical"]. */
}

/**
 * Mutable variant of DevLensEvent, used internally by the Event Bus while
 * running the middleware pipeline. Middleware may mutate in place for
 * performance, or return a new object via spread — both are supported.
 * Once middleware finishes, the event is frozen and treated as a
 * public, readonly DevLensEvent from that point on.
 */
export type MutableDevLensEvent = {
  -readonly [K in keyof DevLensEvent]: DevLensEvent[K];
};

/**
 * Shape used when reporting a new event. id, version, and timestamp are
 * optional here since the Event Bus assigns them when absent — callers
 * shouldn't need to know the current schema version just to report an event.
 */

export type DevLensEventInput = Omit<DevLensEvent, "id" | "timestamp" | "version"> & {
  id?: string;
  timestamp?: number;
  version?: 1;
};












