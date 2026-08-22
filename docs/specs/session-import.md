# Session Import

## Status

Implemented. Frozen 2026-08-14, implemented across Milestones 1–4
(Core `addMany()`/`capacity`; pure parsing/validation leaves; Store
precondition composition; public `importSession()` entry point) —
584/584 workspace tests passing, clean typecheck, clean build,
verified 2026-08-14. Derived from
[ADR-0011](../adr/0011-session-import.md) (Accepted). This spec
resolves the two implementation-level questions ADR-0011 deliberately
left open — the validation result/error shape and validation
sequencing — plus the concrete function signatures, file layout, and
test requirements the ADR doesn't own. It does not re-argue anything
ADR-0011 settled; see that document and
[`docs/research/session-import.md`](../research/session-import.md)
for the architectural reasoning behind each constraint referenced
here.

## Purpose

Restore a previously exported `DevLensEvent[]` session into an empty
`EventStore`, preserving each event's original identity and the
serialized array's ordering exactly.

## Goals

- Parse exported JSON and validate the complete input before any Store
  mutation.
- Enforce `version === 1` per event (ADR-0011 Decision 4).
- Enforce the closed v1 event shape — reject unknown/extra fields
  (Decision 6).
- Enforce `id` uniqueness, both within the imported batch and against
  the Store (Decision 7).
- **Reject an import that would exceed the target Store's capacity**,
  rather than allow `RingBuffer` eviction to silently discard part of
  the imported session — see Validation contract, condition 11, below.
  Without this, the round-trip invariant below would be false for any
  import larger than the Store's capacity, which the rest of this
  spec does not otherwise guard against.
- Deep-freeze every accepted event before it reaches the Store.
- Insert atomically via `EventStore.addMany()` — either the entire
  session is added, or nothing is (Decision 5, Decision 9).
- Preserve each event's original `id`, `timestamp`, and the array's
  serialized order exactly.
- Produce a specific, actionable reason when an import is rejected.
- Leave the Store completely untouched on any failure.

**Round-trip invariant**, established by ADR-0011 and restated here as
the property implementation must satisfy:

```text
A → export(A) → import(export(A)) → B
A[i] ≡ B[i]   for every i
```

## Non-goals

Carried forward from ADR-0011 without reopening:

- Merging into a non-empty Store (Decision 8 — import requires an
  empty Store)
- Routing imported events through `EventBus` (Decision 2)
- Regenerating imported event `id`s or `timestamp`s (Decision 2,
  Decision 7)
- Migration framework, schema registry, or version negotiation
  (Decision 4)
- Document-level export schema/version metadata
- Timestamp-based sorting, in the Store or the Panel (Decision 8)
- Partial import / per-event success (Decision 5)
- A stateful batching API (`beginBatch()`/`endBatch()`) (Decision 9)
- Any UI for triggering import, progress display, or presenting
  failure reasons to the person using the Panel — this spec covers the
  data-layer operation only. A UI surface (mirroring
  `session-controls.ts`'s relationship to `serialize.ts`) is separate,
  later work.

## Principles

- **Import is a session operation, not a capture source.** It has no
  lifecycle (`install()`/`uninstall()`), observes nothing, and runs
  once per invocation, triggered externally (eventually by the Panel,
  not by this spec's scope).
- **Import logic is DOM-free and independently testable**, structurally
  parallel to `serialize.ts` — no dependency on the Renderer or Panel
  UI state (ADR-0011 Decision 1).
- **Event-level validation completeness, not event-level validation
  order, is the contract.** Conditions 1–3 and the Store preconditions
  (conditions 10–11) follow a fixed, contractual sequence (see
  Validation contract, below). Within event-level checks (conditions
  4–9), implementation may check in any order or combined into a
  single pass; only completeness before any Store mutation is
  required.
- **Ordinary invalid input is not a thrown error.** The existing
  project convention for thrown `Error` subclasses
  (`EventBusDestroyedError`, `MiddlewareError`, in `@devlens/core`) is
  reserved for programming errors — a caller violating an API
  contract they controlled. A malformed import file is expected,
  ordinary external input, not a programming error; it is represented
  as a structured result, not a throw. (See Failure contract, below.)

## Import contract

Two-stage shape, matching ADR-0011 Decision 3's diagram exactly:

```text
raw JSON string
        ↓
   parseImportInput()        — JSON.parse; check top-level is an array
        ↓
   validateImportedEvents()  — full-batch validation; see Validation contract
        ↓
   (on success) deepFreeze() each validated event
        ↓
   EventStore.addMany(events) — see EventStore.addMany() contract
        ↓
   ImportResult
```

### Public function signature

```ts
// packages/panel/src/import.ts

export function importSession(
  input: string,
  store: EventStore
): ImportResult;
```

Takes a raw JSON string (matching what `serializeEvents()` produces
and what a person would actually have — a file's text contents) and
the target `EventStore`. Internally parses, validates, freezes, and
inserts. Returns a result describing success or the specific reason
for failure; never throws for ordinary invalid input (parse errors,
schema violations, collisions, non-empty-Store precondition failures
are all represented in the result, not as exceptions).

`importSession()` is the only function this spec requires to be
exported from `packages/panel/src/index.ts`. Internal helpers
(`parseImportInput`, `validateImportedEvents`, whatever shape the
implementation settles on) are implementation detail — not required
to be public, following the same pattern `serialize.ts`'s
`serializeEvents()` already uses.

## Validation contract

Applied to the full parsed array before any Store mutation. Each
condition below causes rejection of the *entire* import (Decision 5)
— none are per-event partial failures.

| # | Condition | Source |
|---|---|---|
| 1 | Input is valid JSON | Import trust boundary |
| 2 | Parsed top-level value is an array | Import trust boundary |
| 3 | Every array element is a plain object | Import trust boundary |
| 4 | Every event has all required `DevLensEvent` fields, correctly typed: `id: string`, `origin: string`, `category: string` (any string — see `EventCategory`'s openness, below), `severity` one of the six `EventSeverity` literals (see condition 5), `title: string`, `message: string`, `timestamp: number`; if present, `stack: string`, `tags: string[]` (array where every element is a `string`), `metadata: Record<string, unknown>` (a plain object — any value, not type-checked deeper than "is a plain object"), `context: Record<string, unknown>` (same) | ADR-0011 Decision 6 (shape) |
| 5 | Every event's `severity` is one of the six valid `EventSeverity` values | Closed union — part of shape validation |
| 6 | Every event's `version` is exactly `1` | ADR-0011 Decision 4 |
| 7 | No event has fields beyond the known `DevLensEvent` shape | ADR-0011 Decision 6 |
| 8 | No two events in the array share an `id` | ADR-0011 Decision 7 |
| 9 | No event's `id` already exists in the target Store (defense-in-depth invariant — see note below the table; not independently reachable through the public `importSession()` contract while condition 10 holds) | ADR-0011 Decision 7 |
| 10 | The target Store is currently empty (`store.getAll().length === 0`) | ADR-0011 Decision 8 |
| 11 | The imported event count does not exceed the target Store's capacity (`events.length <= store.capacity`) | New — see below; not addressed by ADR-0011 |

**Note on conditions 9 and 10:** these two conditions interact in a way
worth stating explicitly, since together with the public `ImportError`
codes below they could otherwise look contradictory. Given condition
10 (empty Store required), condition 9 can never actually fail through
`importSession()`'s public contract — an empty Store has no existing
ids to collide with, so `store-not-empty` (condition 10's failure)
will always be reported first if the Store is non-empty, and
`id-collision-with-store` (condition 9's failure) is consequently
unreachable from the public API under normal operation. Condition 9 is
retained anyway, as a defense-in-depth invariant at the validation
layer — it exists to protect against a future change (a relaxed
empty-Store precondition, an internal validation-ordering change, or
direct use of an internal helper) silently reintroducing a collision
that nothing else would catch. It is not dead code to be removed; it
is simply not exercised by any test that goes through the public
`importSession()` entry point (see Testing requirements, below).

**Note on condition 11 — a gap not addressed by ADR-0011, closed
here.** `EventStore.addMany()` uses `RingBuffer`'s existing capacity
and eviction behavior unmodified (per its own contract, below) — it
was never asked to reject an oversized batch, only to store what it's
given. But `importSession()`'s claimed round-trip invariant
(`A[i] ≡ B[i]` for every imported event) would be silently false for
any import whose length exceeds the target Store's capacity: the
oldest imported events would be evicted by `RingBuffer`'s normal
behavior before `importSession()` ever returns `ok: true`, and the
caller would have no way to know part of the "restored" session was
never actually retained. This is a real gap, not a hypothetical one —
`importSession()` accepts arbitrary JSON, and nothing before this
condition constrains its length. Condition 11 closes it by rejecting
the import outright rather than allowing eviction to mask data loss
behind a reported success.

**Consequence: `EventStore` needs a way to expose its own capacity.**
`maxEvents` is currently a private closure variable inside
`createEventStore()`, never returned on the `EventStore` interface —
nothing today can ask a Store "how large are you allowed to grow."
Condition 11 cannot be implemented without this. This spec therefore
adds one further narrow read-only accessor to `EventStore`, alongside
`addMany()`:

```ts
interface EventStore {
  // ...existing methods, unchanged...
  addMany(events: DevLensEvent[]): void;
  readonly capacity: number;
}
```

Justified on the same narrow grounds as `addMany()` itself
(ADR-0011 Decision 9): a concrete, demonstrated need, not speculative
API surface. `capacity` returns the Store's configured `maxEvents`
(the constructor's `options.maxEvents`, defaulting to
`DEFAULT_STORE_SIZE`) — a fixed value for the Store's lifetime, never
computed from current contents. This is a read-only property, not a
method with any side effect or validation role — consistent with the
Store's existing "pure storage primitive" boundary (ADR-0011 Decision
3). This is an addition to this spec, not something ADR-0011
anticipated; if judged to rise to the level of needing its own ADR
amendment rather than a spec-level addition, that's a call for review,
not assumed here.

**Ordering note:** three tiers, not one flat "any order" rule.

1. **Conditions 1–3 are necessarily sequential** — you can't check
   array-element shape before confirming there's an array, and can't
   confirm there's an array before parsing succeeds.
2. **The Store preconditions — emptiness (condition 10) and capacity
   (condition 11) — are checked immediately after conditions 1–3,
   before any event-level validation begins**, in that order (empty
   check first, since it's the pre-existing rule; capacity check
   second, since it's specific to *this* import's size). This is a
   deliberate, narrow exception to the general non-contractual-
   ordering rule below, made specifically so neither Store precondition
   can be masked by an event-level failure (e.g. `unsupported-version`)
   that happened to be checked first. Without this exception, "any
   order" for conditions 4–11 together would make it possible for a
   non-empty (or oversized-relative-to-import) Store *and* a malformed
   event to both be present, with the reported `ImportError` depending
   on implementation-internal iteration order — exactly the kind of
   ambiguity a spec exists to close.
3. **Conditions 4–9 (event-level validation: shape, version, unknown
   fields, id uniqueness) may be checked in any order or combined into
   a single pass** — this part remains non-contractual, per the
   Principles section above. Implementation must fail fast and return
   the first violation encountered among these conditions (per the
   Fail-fast decision in Failure contract, below) — it does not
   collect or aggregate multiple violations before reporting.

Full sequence:

```text
parse JSON (condition 1)
  ↓
confirm array (condition 2), confirm elements are objects (condition 3)
  ↓
Store is empty? (condition 10) — no → store-not-empty, stop here
  ↓
import length <= Store capacity? (condition 11) — no → import-too-large, stop here
  ↓
event-level validation (conditions 4–9, any internal order, fail-fast)
  ↓
all valid → freeze every event → addMany()
```

This resolves the specific tiebreak a non-empty or oversized Store
combined with malformed input would otherwise leave ambiguous:
malformed JSON (condition 1) and a non-array root (condition 2) are
reported before either Store precondition ever runs, since they occur
structurally earlier in the sequence — but as soon as a valid array of
objects exists, both Store preconditions are checked and reported
before any individual event is inspected, guaranteeing neither is ever
masked by an event-level error.

`EventCategory`'s existing open-string extensibility (any string is a
legal `category`) is preserved — condition 4 validates that `category`
is a string, not that it matches a closed set. This is deliberately
different from `severity` (condition 5), which is a genuinely closed
union.

## Failure contract

```ts
export type ImportResult =
  | { ok: true; importedCount: number }
  | { ok: false; error: ImportError };

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
```

Each `ImportError` variant carries enough structured detail
(`eventIndex`, `field`, `id`, where applicable) for a future caller —
console logging today, a UI surface later — to explain *what* failed
and *where*, without needing to re-parse `message`. `message` itself
is a human-readable string for direct display/logging; the `code` and
structured fields are what a caller should branch on programmatically.

`field` on `invalid-event-shape` is optional, not always present:
when the array element itself is the wrong shape (e.g. `"hello"` or
`42` instead of an object), there is no meaningful field to name, and
`field` is omitted rather than populated with a placeholder value.
When a specific field within an otherwise-object element is missing
or mistyped (e.g. `severity: 42`), `field` names it (`"severity"`).

**Fail-fast, not aggregation.** `importSession()` returns the first
validation failure it encounters, according to whatever deterministic
order the implementation validates in — it does not aggregate multiple
violations into a combined report. This follows directly from
`ImportResult`'s own shape: `ImportError` is a single value, not a
collection, and this spec does not ask implementation to invent an
aggregated form the type doesn't represent. Combined with the
Principles section's "validation order is non-contractual": a caller
can depend on *invalid input → `ok: false` → Store untouched*, but not
on *which* field or event wins when multiple things are wrong with the
same import. If aggregated, multi-error reporting is ever wanted, it's
a distinct future decision with its own result-shape implications, not
something this contract already supports informally.

`store-not-empty` and `import-too-large` are both checked and reported
independently of per-event validation — they're preconditions on the
Store/import as a whole, not properties of individual event data, so
neither carries an `eventIndex`. `import-too-large` carries `count`
(the imported array's length) and `capacity` (the target Store's
`capacity`, per the new accessor below) so a caller can report the
actual numbers involved, not just that the import was rejected.
Because these are preconditions, they are reported before per-event
validation ever has a chance to observe an `id` collision against
Store contents — see the notes on conditions 9/10 and condition 11 in
the Validation contract, above, for the resulting relationship between
these precondition errors and `id-collision-with-store`.

## `EventStore.addMany()` and `capacity` contract

New `@devlens/core` primitives, per ADR-0011 Decision 9 (`addMany()`)
and this spec (`capacity` — see the note on condition 11, above, for
why this accessor is required and why it's justified on the same
narrow grounds `addMany()` was):

```ts
// packages/core/src/store.ts

interface EventStore {
  // ...existing methods, unchanged...
  addMany(events: DevLensEvent[]): void;
  readonly capacity: number;
}
```

`capacity` guarantees:

- Returns the Store's configured `maxEvents` (the value passed to
  `createEventStore({ maxEvents })`, defaulting to
  `DEFAULT_STORE_SIZE` if omitted).
- Fixed for the Store's lifetime — does not change as events are
  added, cleared, or evicted. It answers "how large can this Store
  ever grow," not "how full is it right now" (that remains
  `store.getAll().length`, unchanged).
- Read-only; no method, no side effect, no validation role. Consistent
  with the Store's existing "pure storage primitive" boundary — it
  exposes a fact about the Store's configuration, the same way
  `getAll()` exposes a fact about its contents.

`addMany()` guarantees:

- Accepts an array of already-valid, already-frozen `DevLensEvent`
  objects — performs no validation and no freezing itself, exactly as
  `add()` performs none today. **This explicitly includes no capacity
  check.** `addMany()` does not reject an oversized batch; it applies
  `RingBuffer`'s normal eviction behavior exactly as `add()` would if
  called repeatedly. Rejecting an import that would exceed capacity
  (condition 11) is Import's responsibility, checked *before*
  `addMany()` is ever called — `addMany()` itself remains a generic
  storage primitive with no awareness that "this batch came from an
  Import operation with a round-trip invariant to protect." Keeping
  the capacity constraint in Import, not in `addMany()`, preserves the
  boundary: `@devlens/core` stores what it's given; `@devlens/panel`
  decides what's safe to give it.
- Appends every event to the underlying `RingBuffer`, in the array's
  supplied order, using the buffer's existing `push()` — same capacity
  and eviction behavior `add()` already has, unchanged.
- If the array contains one or more events, notifies subscribers
  exactly once, after all events have been appended — not once per
  event. **If the array is empty, `addMany()` performs no mutation and
  no notification** — an empty batch is not a Store state transition,
  so there is nothing for a subscriber to be notified about. This is a
  deliberate implementation-level decision made by this spec (ADR-0011
  establishes the "append + notify once" contract for a non-empty
  batch but doesn't address the zero-event case), chosen over "every
  call notifies exactly once regardless of length" specifically to
  avoid a pointless Panel recomputation when importing a legitimately
  empty exported session.
- `add()` is completely unmodified by this addition. `addMany([event])`
  is not required to be behaviorally identical to `add(event)` in
  every respect (notification batching internals may differ), but both
  must leave the Store in the same observable end state for that one
  event.

This is Import's only caller of `addMany()` in this milestone, but
`addMany()` and `capacity` are both general Store primitives, not
Import-specific — `addMany()` takes `DevLensEvent[]`, not anything
import-shaped, and neither has any dependency on
`packages/panel`.

## Implementation boundaries

```text
packages/core/src/store.ts       — add addMany(), add capacity, + tests
packages/panel/src/import.ts     — importSession() and internal helpers
packages/panel/src/import.test.ts
packages/panel/src/index.ts      — export importSession
```

Internal decomposition within `import.ts` (whether validation lives in
one function or several, e.g. a separate `validateImportedEvents()`
helper) is left to implementation — ADR-0011 establishes that Import
is DOM-free and lives in `@devlens/panel`, not a specific internal
module split. If validation logic grows large enough to warrant its
own file, that's an implementation-time call, not a spec requirement.

**Implemented naming (added post-implementation, for reference — not a
retroactive rename of this spec's illustrative names above, which were
never contractual):**

```text
parseImportInput(raw)                      — conditions 1–3
validateEvent(value, eventIndex)           — conditions 4–7, one event
validateAllEvents(values)                  — conditions 4–8, whole array,
                                              Store-independent
validateImportSession(raw, store)          — adds conditions 9–11 (Store
                                              preconditions + Store-side
                                              collision defense-in-depth);
                                              not anticipated by name
                                              above — emerged as the
                                              natural home for Store
                                              preconditions once
                                              implementation reached that
                                              layer
importSession(input, store)                — public entry point, matches
                                              this spec's naming exactly
```

`validateEvent`/`validateAllEvents`/`validateImportSession` are all
exported from `import.ts` for direct unit testing (per this section's
own allowance), but only `importSession` (plus `ImportResult`/
`ImportError`) is re-exported from `packages/panel/src/index.ts` — the
actual public boundary. This section is updated to reflect what
shipped; `docs/research/session-import.md` is left as the historical
record of the design conversation and is not edited to match.

## Testing requirements

**Valid imports**:

- Empty array imports successfully (`importedCount: 0`), Store remains
  empty, **no** `notify()` call occurs — an empty batch is not a Store
  state transition (see `EventStore.addMany()` contract, above; worth
  an explicit test since it's an easy edge case to get backwards).
- Single event imports successfully.
- Multiple events import successfully, in the original array's order.
- Imported event's `id` is preserved exactly.
- Imported event's `timestamp` is preserved exactly.
- Imported event's `version` is preserved as `1`.
- Every imported event is deeply frozen (`Object.isFrozen()`, and
  frozen at least one level into `metadata`/`context` if present —
  mirroring `deep-freeze.test.ts`'s existing coverage style).
- Exactly one Store subscriber notification occurs for a multi-event
  import, not one per event.

**Invalid imports** — each must leave the Store completely untouched
and return the correspondingly specific `ImportError` code:

- Malformed JSON (`invalid-json`)
- Parsed JSON is not an array — object, string, number, `null`
  (`not-an-array`)
- Array element is not an object — string/number/array element
  (`invalid-event-shape`)
- Missing required field (`invalid-event-shape`)
- Wrong field type (e.g. `severity` as a number) (`invalid-event-shape`)
- Invalid `severity` value not in the closed union
  (`invalid-event-shape`)
- `version !== 1` (`unsupported-version`)
- Extra/unknown top-level field (`unknown-field`)
- Duplicate `id` within the imported array (`duplicate-id-in-batch`)
- Import attempted against a non-empty Store (`store-not-empty`) — a
  Store seeded with any event, then an otherwise-valid import
  attempted against it, must be rejected with `store-not-empty`, and
  the Store's original contents must be unchanged (not just "no new
  events added" — the pre-existing event must still be present and
  untouched).
- Import whose event count exceeds the target Store's `capacity`
  (`import-too-large`) — construct a Store with a small `maxEvents`
  (e.g. 5, not the 10,000 default, to keep the test fast) and attempt
  to import 6 otherwise-fully-valid events; must be rejected with
  `import-too-large` carrying `count: 6, capacity: 5`, and the Store
  must remain empty (not partially filled with the first 5). This is
  the test that most directly exercises the round-trip invariant this
  condition protects — without it, nothing would catch a regression
  that let `RingBuffer` eviction silently run during import.
- Import whose event count exactly equals the target Store's
  `capacity` must succeed (boundary case — confirms condition 11 uses
  `<=`, not `<`, i.e. an import that exactly fills the Store is valid,
  not rejected).

**Not tested through `importSession()` — a deliberate omission, not a
gap:** `id-collision-with-store` cannot be exercised through the
public `importSession()` contract, because any Store containing an
existing event already fails with `store-not-empty` before per-event
`id`-collision checking would run (see the conditions 9/10 note in
Validation contract, above). No test should attempt to seed the Store
and assert `id-collision-with-store` through `importSession()` — such
a test would be asserting behavior the public contract cannot produce,
and would either be unreachable (masked by `store-not-empty` firing
first) or would indicate a real bug if it somehow succeeded. If the
implementation exposes its internal `id`-collision check as a
separately testable unit (not required by this spec, per
Implementation boundaries, above), that internal helper may be tested
directly against a non-empty existing-ids set; this is left to
implementation's discretion and is not a required test for this
milestone.

**Atomicity**:

- A large array (e.g. 100+ events) with one invalid event anywhere in
  the array (first, middle, and last position — three separate tests)
  results in zero events added to the Store.
- No subscriber notification occurs on any failed import.

**`EventStore.addMany()` and `capacity` (Core-level, separate from
Import's own tests)**

- `capacity` returns the configured `maxEvents` value passed to
  `createEventStore()`.
- `capacity` returns `DEFAULT_STORE_SIZE` when `maxEvents` was not
  specified at construction.
- `capacity` does not change after events are added, cleared, or
  evicted — it reflects configuration, not current fill level.
- Appends multiple events in supplied order.
- Notifies subscribers exactly once for a non-empty batch, regardless
  of length.
- **`addMany([])` produces no mutation and no notification** — a
  dedicated test distinct from the general "notifies once" case above,
  since it's the opposite behavior at the boundary.
- Respects existing `RingBuffer` capacity/eviction behavior when the
  batch would exceed remaining capacity.
- Performs no validation or freezing — passing an already-invalid
  shape (bypassing TypeScript, as a test would need to) is not
  `addMany()`'s concern; this test exists to confirm `addMany()`
  doesn't accidentally start doing Import's job.

**Round trip**:

- `store.getAll()` before export, compared element-by-element against
  `store.getAll()` of a fresh Store after
  `importSession(serializeEvents(originalEvents), freshStore)` —
  confirms `A[i] ≡ B[i]` for every field, not just a subset.

## Open questions

None. Per this spec's purpose, both mechanics ADR-0011 left open
(validation result shape, validation sequencing) are resolved above —
`ImportResult`/`ImportError` for the former, "completeness not order
is contractual" for the latter.

## Milestones

Not sequenced here as multiple phases — unlike `inspection.md`'s
multi-session arc, this spec describes one cohesive unit of work sized
similarly to a single Network sub-step (e.g. ADR-0010's Phase
0.5/Step 2/3A). Suggested implementation order, consistent with the
project's leaf-first discipline:

1. `EventStore.addMany()` and `EventStore.capacity` in
   `@devlens/core`, with their own tests (pure leaf, no dependency on
   Import).
2. `parseImportInput()` + shape/version/unknown-field validation in
   `@devlens/panel`, with tests — pure functions, no Store dependency
   yet.
3. `id` collision validation (intra-batch, then Store-side) and the
   Store-precondition checks (empty, capacity), with tests.
4. `importSession()` composition — wiring parse → Store preconditions
   → event validation → freeze → `addMany()` → `ImportResult`, with
   integration tests (the atomicity and round-trip suites above).
5. Full workspace test/typecheck/build before considering the
   milestone done, per standing project discipline.

No Panel UI, no `import-controls.ts`-equivalent component, is in scope
for this spec — that's later work, contingent on this data-layer
operation existing and being approved first.
