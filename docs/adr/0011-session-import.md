# 0011: Session Import and Batched Store Insertion

## Status

Accepted — drafted from `docs/research/session-import.md`, all eight
decisions in that document reviewed and settled prior to this ADR,
reviewed and accepted 2026-08-14. This ADR records what that process
converged on; it does not reproduce the research's investigative
reasoning. See the research document for the full trade-off analysis
behind each decision below.

## Context

Export (`serializeEvents()`, `@devlens/panel`) already exists and
produces a raw `DevLensEvent[]` JSON array from `store.getAll()`.
Import is the other direction: taking a previously exported file and
restoring its events into a running Panel's `EventStore`.

This is architecturally new in one specific way: it is the first time
DevLens has needed to accept input that did not originate from a
trusted, first-party, type-checked producer. Every existing event —
Runtime, Console, Network — reaches the Store through
`EventBus.report()`, which performs no runtime validation because it
has never needed to; its callers were always constrained by
TypeScript at compile time. Import breaks that assumption, and this
ADR exists because the research process determined that admitting
untrusted input safely required real design decisions, not just an
implementation.

## Decision

### 1. Import lives in `@devlens/panel`, not a dedicated package

Import is a Panel-owned session operation — the counterpart to
`serialize.ts` — not an independent capture source. It does not
observe the host environment the way Runtime/Console/Network do, has
no `install()`/`uninstall()` lifecycle, and is triggered by the Panel
rather than running independently. Import logic remains DOM-free and
independently testable, structurally parallel to `serialize.ts`; it
must not depend on the Renderer or Panel UI state.

A dedicated `@devlens/import` package is explicitly deferred, not
rejected — revisit if Import later develops an independently useful
public API, non-Panel consumers, or substantial complexity on its own
terms.

### 2. Import bypasses `EventBus` entirely

Imported events are validated and inserted directly into the
`EventStore`, never routed through `EventBus.report()`. `report()`
regenerates `id`/`timestamp` for any input that omits them, and an
imported event's original `id`/`timestamp` are its historical identity
— the entire point of restoring a past session. Routing through
`report()` would silently discard that identity, so this is a
disqualification, not a preference between comparably good options.

This exercises a seam the Store's own architecture already
anticipated: `EventStore` (ADR-0004) is deliberately decoupled from
`EventBus`, with its own documentation naming an imported session file
as a legitimate direct source. This ADR does not introduce a new
ownership model — it uses one that was already left open.

### 3. Import validates and deep-freezes events before Store insertion

```text
Import boundary
  parse
    ↓
  validateImportedEvents()
    ↓
  deepFreeze() (each event)
    ↓
EventStore.addMany()
```

`deepFreeze()` (existing, `@devlens/core`, unmodified) guarantees
immutability of an already-valid object; it does not itself validate
shape. Validation and freezing are two distinct steps, not one merged
"integrity" function. The Store remains a pure storage primitive — it
owns data, not validation policy; that responsibility belongs to
Import, since Import is what introduces the trust boundary that makes
it necessary. `EventStore.addMany()` (Decision 9) is the bulk
insertion path Import uses; `EventStore.add()` remains the existing
single-event insertion primitive used by first-party capture via
`connectStoreToBus()`, unchanged by this decision.

### 4. `version === 1` is a per-event schema compatibility contract

`version` on `DevLensEvent` was, prior to this decision, written by
Export but read by nothing. Import gives it a real, narrow job:
"which serialized `DevLensEvent` schema this object conforms to" — not
an event lifecycle counter, not a DevLens release marker. Checked
per-event (the serialized shape is an array of independently-versioned
events, not a document with one shared version). An event with
`version !== 1` is treated as an incompatible event, which under
Decision 5 fails the whole import.

Explicitly excluded from this milestone: migration infrastructure, a
schema registry, version negotiation, backward-compatibility matrices,
`v1 → v2` migration functions, and document-level version metadata.
None of this has a second version to justify it yet.

### 5. Import is atomic — whole-import rejection, not per-event

If any event in an imported file fails validation for any reason
(shape, unknown fields, version, id collision), the entire import is
rejected and the Store is left untouched. There is no partial-success
path and no `store.add()`/`store.addMany()` call occurs until every
event in the batch has been validated and frozen.

This was chosen over per-event rejection specifically because Import
restores a *historical* session, and a partially restored one is
actively misleading rather than merely incomplete — nothing downstream
(Store, Panel, Renderer) has any concept of "this session was
partially restored," so a silently-partial import would present as a
complete, legitimate session missing an unknown quantity of its
original events.

### 6. Unknown or extra fields on an imported event cause rejection

The v1 `DevLensEvent` schema is closed for Import's purposes: an
imported event object may contain only the fields defined by the
supported schema version. Extra or unrecognized fields fail validation
for that event (and, per Decision 5, the whole import).

This keeps the `version` contract (Decision 4) meaningful rather than
nominal — silently accepting or stripping fields the current importer
doesn't recognize would mean the `version` check doesn't actually
bound what shape of data enters the Store. This is distinct from
`EventCategory`'s existing open-string extensibility, which is a
narrow, deliberate exception for one field, not a license for
arbitrary top-level properties.

### 7. Imported event IDs must be unique — within the batch and against the Store

Two checks, both required: no two events within the imported array may
share an `id` (load-bearing, always enforced), and no imported event's
`id` may already exist in the Store (defense-in-depth under Decision
8's empty-Store precondition — checking against an empty Store can
never itself reject anything in normal v1 operation, but remains real
protection if that precondition is ever violated). Either collision
type fails the whole import under Decision 5. Collision detection is
`O(n + m)` via a `Set` seeded with existing Store ids, not a nested
scan.

Regeneration on collision was considered and rejected — it would
violate Decision 2's identity-preservation guarantee in exactly the
same way Bus-routing would. Allowing duplicate ids was considered and
rejected — it would make repeated import of the same file silently
duplicate a session's events rather than signaling that they're
already present.

### 8. Import requires an empty `EventStore`

Import is **session restoration, not session merging**. No sort by
`timestamp` exists anywhere in the codebase (`EventStore.getAll()`
returns pure insertion order); the Panel's event list has only ever
appeared chronological as a side effect of live capture always
inserting events in the order they occur. Import is the first
operation that can make an event's `timestamp` diverge from the moment
of insertion, and allowing import into a non-empty Store would turn
that previously-accidental ordering guarantee into a visible,
unresolved inconsistency (an imported event could render after later
live events despite having an earlier timestamp).

Requiring an empty Store sidesteps this without any Core or Panel
sorting change: `EventStore.addMany()` (Decision 9) inserts in exactly
the serialized array's order, giving an exact round trip —
`Store A → export → import into empty Store → Store B`, with
`A[i] ≡ B[i]` for every event, including original `id` and
`timestamp`.

Session merging (importing into a Store that already holds live
events) is explicitly out of scope for this decision, not solved by
it. The v1 workaround, if a person wants to inspect a past session
without losing current live events, is manual: export the current
session, clear the Store, then import the historical one.

### 9. `EventStore` gains `addMany(events)` — a Core change, amended below to include `capacity`

```text
addMany(events)
    ↓
append events in supplied order
    ↓
notify subscribers exactly once
```

`add()` is unchanged; `addMany()` is a new, narrow sibling — same
"trust the caller, store what you're given" semantics as `add()`,
purely batched at the notification level. It performs no validation
and no freezing; that responsibility stays entirely in Import.

This was accepted narrowly, on a concrete basis: the Store's default
capacity (`DEFAULT_STORE_SIZE`, 10,000) makes a 10,000-event import a
realistic worst case, and under `add()`'s existing one-event/one-
notification contract, that means up to 10,000 synchronous Panel
update cycles for a single restore operation with no useful
intermediate state to observe (per Decision 5, nothing is added to the
Store until the entire import has already validated successfully — so
there is no partial session to render mid-import in the first place).
A stateful batching API (`beginBatch()`/`endBatch()`) was considered
and rejected as unnecessary machinery — a single function with a
complete, narrow contract is sufficient.

**Amended 2026-08-14 — see Amendment section below.** At ADR
acceptance time, this was recorded as "the only Core change accepted
anywhere in this decision set." Spec-level work on
`docs/specs/session-import.md` surfaced a second, dependent Core need
(`EventStore.capacity`); that finding is formalized in the Amendment
section rather than by silently editing this claim.

## Consequences

### Positive

- Import gets a well-defined, atomic, round-trip-exact restore
  operation without touching `EventBus` or Core's event-construction
  contract.
- The trust boundary introduced by external input is explicit and
  isolated to Import — no other part of the system has to reason
  about untrusted data.
- `version` becomes a real, checked field for the first time, without
  building migration infrastructure that has no second version to
  serve yet.
- `EventStore.addMany()` is a small, general-purpose primitive that
  may serve future bulk-ingestion needs beyond Import (a future replay
  mechanism, test harness, or persisted-store restoration), without
  having been built speculatively for any of them.
- (Added by 2026-08-14 Amendment) `EventStore.capacity` lets any
  future consumer — not just Import — query the Store's configured
  retention bound without inspecting private implementation details,
  closing a gap that existed silently before this ADR (nothing could
  previously ask a Store "how large are you allowed to grow").

### Negative

- Import v1 cannot merge a historical session into a live one; the
  only supported workflow is restore-into-empty-Store. Anyone wanting
  to compare past and live sessions side by side has a manual,
  multi-step workaround, not a first-class feature.
- A single malformed or version-mismatched event anywhere in a large
  export fails the entire import. There is no partial-recovery path in
  v1 — a session that is mostly valid with one bad event is
  indistinguishable, from Import's perspective, from a session that is
  entirely invalid.
- `EventStore` now has two insertion entry points (`add()` and
  `addMany()`) whose shared storage semantics — insertion order,
  capacity behavior, subscriber notification, caller trust — must
  remain aligned going forward. This is a real maintenance and
  documentation burden, not just a method count: any future change to
  one primitive's contract (e.g. how capacity overflow is handled)
  needs to be deliberately considered against the other, or the two
  entry points can silently drift apart.
- (Added by 2026-08-14 Amendment) `EventStore`'s public surface has
  grown by two members in this single ADR (`addMany()`, `capacity`),
  not one as originally recorded at acceptance. This is a small but
  real expansion of Core's API surface beyond what this ADR initially
  scoped itself to, and is recorded honestly here rather than folded
  silently into the original Decision 9 text.

## Relationship to ADR-0004

This decision extends the `EventStore` API established by ADR-0004 but
does not alter its ownership model or its Bus-agnostic responsibility.
ADR-0004 established that the Store is a storage primitive, decoupled
from the Bus, that may accept events from sources other than
`EventBus` — and explicitly anticipated an imported session as one
such source. This ADR exercises that seam rather than reopening it,
and adds `addMany()` (a second insertion primitive with the same
"trust the caller" contract `add()` has always had) and `capacity` (a
read-only accessor exposing existing configuration, not new behavior)
as two narrow API extensions. ADR-0004 is not amended; nothing here
contradicts it.

## Amendment (2026-08-14): `EventStore.capacity`

During spec-level work on `docs/specs/session-import.md`, a second
dependent Core need was found: Decision 8's empty-Store precondition
prevents `RingBuffer` eviction from silently discarding imported
events *when the Store is empty*, but says nothing about an import
whose event count exceeds the Store's capacity even when starting from
empty. A 12,000-event import into a 10,000-capacity Store would pass
every check this ADR originally specified, then have its oldest 2,000
events evicted by `addMany()`'s normal `RingBuffer` behavior — silently
falsifying the round-trip invariant (`A[i] ≡ B[i]`) this ADR's Decision
8 established as Import's core guarantee, while `importSession()`
still reports success.

Closing this requires rejecting oversized imports as a Store
precondition, alongside Decision 8's empty-Store check — but that
check cannot be implemented without `EventStore` exposing its own
configured capacity, which nothing in the original interface did
(`maxEvents` was a private closure variable, never returned).

**This ADR is amended to accept a second Core addition:**

```ts
interface EventStore {
  // ...existing methods...
  addMany(events: DevLensEvent[]): void;
  readonly capacity: number;
}
```

`capacity` returns the Store's configured `maxEvents` (defaulting to
`DEFAULT_STORE_SIZE`), fixed for the Store's lifetime, read-only, with
no validation or side-effect role — consistent with the Store's
existing "pure storage primitive" boundary, the same standard Decision
9 already applied to `addMany()`. Import uses it to reject an
oversized import *before* calling `addMany()`; `addMany()` itself
remains unmodified and continues to apply normal `RingBuffer` eviction
if ever called with a batch exceeding capacity — the capacity
*constraint* belongs to Import, not to Core, exactly as validation and
freezing already do per Decision 3.

**Revising the earlier characterization:** Decision 9's original text
described `addMany()` as "the only Core change accepted anywhere in
this decision set." That is no longer accurate. The Core changes
accepted by this ADR, as amended, are limited to the two narrow
primitives required by session restoration: `addMany()` for batched
insertion, and `capacity` for exposing the Store's configured
retention bound. Both are justified on the same basis — a concrete,
demonstrated need surfaced by Import's requirements, not speculative
API expansion — and neither grants the Store any new responsibility
for validation, freezing, or policy.

No other decision in this ADR is affected by this amendment. ADR-0004
remains unamended; this addition is the same kind of narrow API
extension Decision 9 already established a precedent for, not a new
category of change.

## Explicitly excluded from this ADR

Considered during research and deliberately not built:

- Migration framework / schema registry / version negotiation
- Session merging (import into a non-empty Store)
- Timestamp-based sorting, in the Store or the Panel
- A stateful batching API (`beginBatch()`/`endBatch()`)
- Document-level export schema/version metadata
- Any change to `EventBus.report()`'s behavior or contract

## Open questions

None. The implementation-level mechanics left open at ADR acceptance
time — the exact `validateImportedEvents()` return/error shape, and
internal validation ordering — are resolved by
`docs/specs/session-import.md`, which defines the `ImportResult` /
`ImportError` contract and the required parse → array/object checks →
Store preconditions → event-level validation sequence. The ADR
intentionally leaves those mechanics to the spec; the spec owns them.
