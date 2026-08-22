import { deepFreeze, type DevLensEvent, type EventStore } from "@devlens/core";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * The result of an importSession() call. On success, reports how many
 * events were added to the Store. On failure, carries a structured
 * ImportError describing the first validation violation encountered.
 * Never throws for ordinary invalid input — see docs/specs/session-import.md,
 * "Failure contract," for the rationale.
 */
export type ImportResult =
  | { ok: true; importedCount: number }
  | { ok: false; error: ImportError };

/**
 * Discriminated union of every failure mode importSession() can produce.
 * The code field is the programmatic discriminant; message is human-readable.
 * eventIndex locates the failing event when the failure is per-event.
 * field locates the failing property when the failure is per-field (optional
 * on invalid-event-shape because an element that isn't an object at all has
 * no field to name).
 */
export type ImportError =
  | { code: "invalid-json"; message: string }
  | { code: "not-an-array"; message: string }
  | { code: "invalid-event-shape"; eventIndex: number; field?: string; message: string }
  | { code: "unsupported-version"; eventIndex: number; message: string }
  | { code: "unknown-field"; eventIndex: number; field: string; message: string }
  | { code: "duplicate-id-in-batch"; eventIndex: number; id: string; message: string }
  | { code: "id-collision-with-store"; eventIndex: number; id: string; message: string }
  | { code: "store-not-empty"; message: string }
  | { code: "import-too-large"; count: number; capacity: number; message: string };

// ---------------------------------------------------------------------------
// Internal constants
// ---------------------------------------------------------------------------

const VALID_SEVERITY = new Set([
  "trace",
  "debug",
  "info",
  "warn",
  "error",
  "fatal",
]);

/**
 * Exhaustive set of known DevLensEvent field names for the closed v1 schema.
 * Any key not in this set on an imported event causes an unknown-field error.
 * category is intentionally NOT a closed set of values (it's open-string for
 * plugin extensibility), but it IS a known field name.
 */
const KNOWN_FIELDS = new Set([
  "id",
  "version",
  "origin",
  "category",
  "severity",
  "title",
  "message",
  "timestamp",
  "stack",
  "metadata",
  "context",
  "tags",
]);

const REQUIRED_STRING_FIELDS = [
  "id",
  "origin",
  "category",
  "severity",
  "title",
  "message",
] as const;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// Parse layer
// ---------------------------------------------------------------------------

/**
 * Parse a raw JSON string and verify the top-level value is an array.
 * Returns the parsed array on success, or an ImportError on the first
 * structural failure (invalid-json, not-an-array).
 *
 * Internal — this is the first step in importSession()'s pipeline.
 * Exported for direct testing; not re-exported from index.ts.
 */
export function parseImportInput(
  raw: string
): { ok: true; value: unknown[] } | { ok: false; error: ImportError } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      ok: false,
      error: { code: "invalid-json", message: "Import input is not valid JSON." },
    };
  }

  if (!Array.isArray(parsed)) {
    const got = parsed === null ? "null" : typeof parsed;
    return {
      ok: false,
      error: {
        code: "not-an-array",
        message: `Import input must be a JSON array; got ${got}.`,
      },
    };
  }

  return { ok: true, value: parsed };
}

// ---------------------------------------------------------------------------
// Per-event validation
// ---------------------------------------------------------------------------

/**
 * Validate a single parsed value as a v1 DevLensEvent.
 * Returns the first ImportError found, or null if the event is valid.
 *
 * Validation ordering within an event is non-contractual per spec —
 * only completeness before any Store mutation is required. The ordering
 * below is: object check → version gate → unknown fields → required
 * fields → optional fields. No aggregation — first violation wins.
 *
 * Internal — called by validateAllEvents(). Exported for direct testing.
 */
export function validateEvent(
  value: unknown,
  eventIndex: number
): ImportError | null {
  // 1. Must be a plain object (no field to name when this fails).
  if (!isPlainObject(value)) {
    return {
      code: "invalid-event-shape",
      eventIndex,
      message: `Event at index ${eventIndex} is not an object.`,
    };
  }

  // 2. version === 1: schema compatibility gate, checked before shape.
  //    A version-2 event with an otherwise valid v1 shape should still
  //    be rejected — this check prevents shape validation from silently
  //    accepting a schema the importer doesn't understand.
  if (value["version"] !== 1) {
    return {
      code: "unsupported-version",
      eventIndex,
      message: `Event at index ${eventIndex} has unsupported version: ${String(value["version"])}. Only version 1 is supported.`,
    };
  }

  // 3. No unknown fields — v1 schema is closed.
  for (const key of Object.keys(value)) {
    if (!KNOWN_FIELDS.has(key)) {
      return {
        code: "unknown-field",
        eventIndex,
        field: key,
        message: `Event at index ${eventIndex} has unknown field: "${key}".`,
      };
    }
  }

  // 4. Required fields that must be strings (category is open-string:
  //    any string is valid, so typeof check is sufficient for it).
  for (const field of REQUIRED_STRING_FIELDS) {
    if (typeof value[field] !== "string") {
      return {
        code: "invalid-event-shape",
        eventIndex,
        field,
        message: `Event at index ${eventIndex}: "${field}" must be a string.`,
      };
    }
  }

  // 5. timestamp must be a finite number.
  if (
    typeof value["timestamp"] !== "number" ||
    !Number.isFinite(value["timestamp"])
  ) {
    return {
      code: "invalid-event-shape",
      eventIndex,
      field: "timestamp",
      message: `Event at index ${eventIndex}: "timestamp" must be a finite number.`,
    };
  }

  // 6. severity must be a valid closed-union value (typeof already passed
  //    in step 4 — this only checks the value itself).
  if (!VALID_SEVERITY.has(value["severity"] as string)) {
    return {
      code: "invalid-event-shape",
      eventIndex,
      field: "severity",
      message: `Event at index ${eventIndex}: "severity" must be one of: trace, debug, info, warn, error, fatal.`,
    };
  }

  // 7. Optional: stack must be a string if present.
  if (value["stack"] !== undefined && typeof value["stack"] !== "string") {
    return {
      code: "invalid-event-shape",
      eventIndex,
      field: "stack",
      message: `Event at index ${eventIndex}: "stack" must be a string when present.`,
    };
  }

  // 8. Optional: tags must be string[] if present.
  if (value["tags"] !== undefined) {
    if (!Array.isArray(value["tags"])) {
      return {
        code: "invalid-event-shape",
        eventIndex,
        field: "tags",
        message: `Event at index ${eventIndex}: "tags" must be an array when present.`,
      };
    }
    for (const tag of value["tags"] as unknown[]) {
      if (typeof tag !== "string") {
        return {
          code: "invalid-event-shape",
          eventIndex,
          field: "tags",
          message: `Event at index ${eventIndex}: every element of "tags" must be a string.`,
        };
      }
    }
  }

  // 9. Optional: metadata must be a plain object if present.
  if (value["metadata"] !== undefined && !isPlainObject(value["metadata"])) {
    return {
      code: "invalid-event-shape",
      eventIndex,
      field: "metadata",
      message: `Event at index ${eventIndex}: "metadata" must be a plain object when present.`,
    };
  }

  // 10. Optional: context must be a plain object if present.
  if (value["context"] !== undefined && !isPlainObject(value["context"])) {
    return {
      code: "invalid-event-shape",
      eventIndex,
      field: "context",
      message: `Event at index ${eventIndex}: "context" must be a plain object when present.`,
    };
  }

  return null;
}

/**
 * Validate all events in a parsed array. Fail-fast — returns the first
 * ImportError encountered, or a typed DevLensEvent[] if all pass.
 * Also enforces intra-batch id uniqueness (condition 8): if two events in
 * the same array share an id, the second occurrence is the failing event.
 *
 * The cast to DevLensEvent[] is safe: every field has been checked above.
 *
 * Internal — called by importSession() in the composition step.
 * Exported for direct testing.
 */
export function validateAllEvents(
  values: unknown[]
): { ok: true; events: DevLensEvent[] } | { ok: false; error: ImportError } {
  const seenIds = new Set<string>();
  const validated: DevLensEvent[] = [];

  for (let i = 0; i < values.length; i++) {
    const error = validateEvent(values[i], i);
    if (error !== null) return { ok: false, error };

    const event = values[i] as DevLensEvent;
    if (seenIds.has(event.id)) {
      return {
        ok: false,
        error: {
          code: "duplicate-id-in-batch",
          eventIndex: i,
          id: event.id,
          message: `Event at index ${i} has duplicate id "${event.id}" — ids must be unique within an imported session.`,
        },
      };
    }
    seenIds.add(event.id);
    validated.push(event);
  }

  return { ok: true, events: validated };
}

// ---------------------------------------------------------------------------
// Composition layer: parse + Store preconditions + event validation
// ---------------------------------------------------------------------------

/**
 * Validate an imported session string through all conditions that do not
 * require Store mutation: JSON parsing and root shape (conditions 1–3),
 * Store-level preconditions (conditions 10–11), per-event validation
 * (conditions 4–7), intra-batch id uniqueness (condition 8), and Store-side
 * id collision as a defense-in-depth invariant (condition 9).
 *
 * Returns the validated DevLensEvent[] on success — unfrozen. Freezing and
 * store.addMany() are importSession()'s responsibility (Milestone 4).
 *
 * Sequencing is contractual at the tier level per the frozen spec:
 *   parse/root shape → Store preconditions (empty, capacity)
 *   → event-level validation (any internal order, fail-fast)
 *   → Store-side id collision (defense-in-depth)
 *
 * Internal — exported for direct testing; not re-exported from index.ts.
 */
export function validateImportSession(
  raw: string,
  store: EventStore
): { ok: true; events: DevLensEvent[] } | { ok: false; error: ImportError } {
  // Conditions 1–3: parse + confirm top-level array + confirm plain objects.
  const parseResult = parseImportInput(raw);
  if (!parseResult.ok) return parseResult;

  const rawEvents = parseResult.value;

  // Condition 10: Store must be empty — checked before event validation so
  // store-not-empty is never masked by an event-level failure.
  if (store.getAll().length !== 0) {
    return {
      ok: false,
      error: {
        code: "store-not-empty",
        message:
          "Import requires an empty EventStore. Call store.clear() first, or export the current session before importing.",
      },
    };
  }

  // Condition 11: import count must not exceed Store capacity — checked
  // immediately after condition 10, still before event-level validation.
  if (rawEvents.length > store.capacity) {
    return {
      ok: false,
      error: {
        code: "import-too-large",
        count: rawEvents.length,
        capacity: store.capacity,
        message: `Cannot import ${rawEvents.length} events into a Store with capacity ${store.capacity}.`,
      },
    };
  }

  // Conditions 4–8: per-event shape/version/unknown-fields/types +
  // intra-batch id uniqueness. validateAllEvents is Store-independent and
  // stays that way — its purity is protected by the ordering here.
  const validationResult = validateAllEvents(rawEvents);
  if (!validationResult.ok) return validationResult;

  // Condition 9: Store-side id collision (defense-in-depth invariant).
  // Under condition 10 the Store is always empty here, making this loop
  // iterate over zero existing ids — a no-op in normal operation. The code
  // is retained as written protection against any future relaxation of the
  // empty-Store precondition silently bypassing this check. Do not remove.
  // This branch is not exercisable through the public importSession() API
  // under the current contract; see the spec (docs/specs/session-import.md,
  // Testing requirements) for the explicit explanation.
  const existingIds = new Set(store.getAll().map((e) => e.id));
  for (let i = 0; i < validationResult.events.length; i++) {
    const event = validationResult.events[i];
    if (existingIds.has(event.id)) {
      return {
        ok: false,
        error: {
          code: "id-collision-with-store",
          eventIndex: i,
          id: event.id,
          message: `Event at index ${i} has id "${event.id}" that already exists in the Store.`,
        },
      };
    }
  }

  return validationResult;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Restore a previously exported DevLensEvent[] session into an empty
 * EventStore, preserving each event's original id, timestamp, and the
 * serialized array's order exactly.
 *
 * Pipeline:
 *   raw JSON → validateImportSession() (parse, Store preconditions,
 *   event validation, intra-batch + Store-side id checks) → deepFreeze
 *   every validated event → store.addMany() → { ok: true, importedCount }
 *
 * Never throws for ordinary malformed input — see ImportError for the
 * structured failure contract. On any failure, the Store is left
 * completely untouched: validateImportSession() only mutates nothing
 * itself, and this function does not call store.addMany() unless
 * validation succeeded in full.
 *
 * Does not regenerate or normalize any field — the frozen events added
 * to the Store are exactly what was in the imported JSON, id and
 * timestamp included.
 */
export function importSession(input: string, store: EventStore): ImportResult {
  const validationResult = validateImportSession(input, store);
  if (!validationResult.ok) {
    return { ok: false, error: validationResult.error };
  }

  const frozenEvents = validationResult.events.map((event) => deepFreeze(event));

  // addMany([]) is itself a no-op (no mutation, no notification) per its
  // own contract — calling it unconditionally here for a zero-length batch
  // is equivalent to skipping the call, and keeps this function's logic
  // uniform rather than special-casing the empty-import path.
  store.addMany(frozenEvents);

  return { ok: true, importedCount: frozenEvents.length };
}
