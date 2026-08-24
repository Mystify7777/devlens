# 0012: EventStore.size

## Status

Accepted. This ADR records the architectural decision only —
`store.ts`, `ring-buffer.ts`, tests, and existing `@devlens/panel`
consumers are all unmodified by this ADR and remain exactly as they
are today; implementing the interface member and migrating consumers
are separate, later steps.

## Context

`EventStore`'s public interface has no way to answer "how many events
does this Store currently hold?" in constant time. `capacity`
(ADR-0011 amendment) exposes the Store's configured *maximum* —
fixed for the Store's lifetime — but nothing exposes current
occupancy, which changes on every `add()`, `addMany()`, `clear()`, and
under `RingBuffer` eviction.

The only way to answer this today is `store.getAll().length` —
materializing every currently-stored event into a new array purely to
read its length. This is not a hypothetical inconvenience: it is the
pattern already used at two real call sites in `@devlens/panel`
(`panel.ts`, for a render-time count, and `import.ts`, as an
empty-Store precondition check inside `validateImportSession()`), both
paying an O(n) allocation for an O(1) question the Store's own
internal `RingBuffer` already answers correctly.

This finding came out of a dedicated Consumer Boundary investigation
into `EventStore` as a public API — not from a specific downstream
feature's requirements the way `addMany()`/`capacity` came out of
Session Import. This ADR exists because there was no other ADR this
addition naturally belonged to.

## Decision

`EventStore` gains one new read-only member:

```ts
interface EventStore {
  // ...existing members...
  readonly size: number;
}
```

### `size` is current occupancy, not a running total

`size` answers "how many events does `getAll()` return right now" —
equivalently, how many events this Store is currently holding. It is
**not** a monotonic counter of every event ever added; it moves
downward on `clear()` and stays capped once the Store is full,
exactly mirroring what `getAll().length` already returns at any given
moment. There is no second definition under consideration here — this
is the same concept `RingBuffer` already implements correctly one
layer down (see below), given a name at the `EventStore` level for
the first time.

### `size` vs. `capacity`: two different, already-precedented questions

```text
size     = how many events are stored right now (changes constantly)
capacity = how many events this Store is configured to hold at most
           (fixed for the Store's lifetime)
```

These are not two views of the same fact. `capacity` was already
established as fixed and configuration-derived (ADR-0011 amendment);
`size` represents current occupancy and therefore changes as Store
contents change. The two properties answer different questions and
should remain independently named and documented.

### Implementation: a direct passthrough to `RingBuffer.size`

`size` is implemented as `get size() { return buffer.size; }`, reading
`RingBuffer`'s own existing `size` getter (`this.count`, already
correctly maintained across `push()` and `clear()`). No independent
Store-level counter is introduced.

An independently-tracked Store-level counter would require correctly
incrementing/decrementing in the same four places `buffer` is already
touched (`add()`, `addMany()`, `clear()`, `destroy()`), reimplementing
`RingBuffer`'s own capacity-capping and eviction arithmetic a second
time for no observable behavioral difference — `RingBuffer.size` and
`getAll().length` are identical by construction at every point in
time, since `toArray()` iterates exactly `this.count` times. A
passthrough cannot drift from the value it mirrors; an independent
counter could only ever match it, never improve on it, while adding a
second piece of state that has to be kept in lockstep by hand. This
mirrors the same "don't build parallel machinery to answer a question
existing state already answers" reasoning ADR-0011 applied when
justifying `addMany()`'s notification batching.

### Behavioral contract

| Condition | `size` |
|---|---|
| Newly created, empty Store | `0` |
| After `add(event)` | increments by exactly 1 |
| After `addMany(events)` | increments by `events.length`, in one step |
| After `addMany([])` | unchanged — matches `addMany()`'s existing true-no-op contract (no mutation, no notification) |
| After `clear()` | resets to `0` |
| Once the Store reaches `capacity` | pinned at `capacity`; further `add()`/`addMany()` calls do not increase it further, regardless of how many events are pushed or how many are evicted as a result |
| After `destroy()` | resets to `0` (`destroy()` already calls `buffer.clear()`) |
| Reuse after `destroy()` | behaves exactly as a freshly-created Store — no lingering value from before `destroy()` was called |

No condition above introduces new Store behavior. `size` only makes
existing, already-correct `RingBuffer` occupancy observable at the
`EventStore` level; every row in this table already held true of
`getAll().length` before this ADR.

### No change to notification semantics

`add()` and `addMany()` continue to notify subscribers exactly as they
do today — once per `add()` call, once per non-empty `addMany()` call,
with `addMany()`'s payload remaining the batch's last event. `size`
being correct at the moment a subscriber's handler runs is a
consequence of it reading live `RingBuffer` state on access, not a new
guarantee this ADR adds — there is no new event, message, or field
added to any notification.

## Relationship to ADR-0004

ADR-0004 established `EventStore` as a pure storage primitive and
defined its original public API. As with `addMany()` and `capacity`
(ADR-0011), this ADR extends that surface with one narrow, read-only
member rather than reopening ADR-0004 itself. **ADR-0004 is not
amended; nothing here contradicts it.** `size` grants the Store no new
responsibility — no validation, no policy, no behavior change — it
only exposes a value the Store's own internal `RingBuffer` was already
computing correctly. This is the same kind of narrow, additive
extension ADR-0011 already established a precedent for, not a new
architectural decision about what the Store *is*.

## Scope boundaries (explicitly not part of this decision)

This ADR authorizes exactly one new member, `readonly size: number`,
and nothing else. In particular, the following remain fully out of
scope and are not implied, motivated, or made more likely by this
addition:

- **`getById(id)` / `get(id)`** — a separate, previously-identified gap
  (Panel currently resolves a single event by a full `getAll().find()`
  scan). Classified as *Useful, not Required* by the Consumer Boundary
  investigation that motivated this ADR; not decided here.
- **A richer subscription protocol** (typed notifications
  distinguishing `add`/`addMany`/`clear`, per-event `addMany` payloads,
  etc.) — no consumer requiring this was identified; `size` does not
  change what a `subscribe()` handler receives.
- **An eviction-specific API** (an eviction event, evicted-event
  payload, or evicted count) — `size` tells a consumer how many events
  exist now, not what happened to cause that number, and nothing in
  this ADR changes that.
- **Additional query methods** (by severity, by time range, or any
  other new `getBy*`/`filter`-adjacent method) — `getByCategory()` and
  `filter()` already exist and are unused by every current consumer;
  this ADR does not add to that surface.

## Consequences

### Positive

- The two existing `getAll().length` call sites in `@devlens/panel`
  can be simplified to `store.size`, removing an O(n) allocation from
  a render-time count and from Import's empty-Store precondition
  check — though migrating them is explicitly not part of this ADR
  (see "Scope boundaries," above).
- Any future non-Panel consumer (CLI, VS Code extension, or otherwise)
  gets an O(1) answer to "how many events are there" without needing
  to discover the same `getAll().length` workaround independently.
- `RingBuffer`'s already-correct occupancy tracking is exposed at the
  boundary consumers actually use, without duplicating or risking
  drift from that tracking.

### Negative

- `EventStore`'s public surface grows by one member. As ADR-0011 noted
  when `addMany()`/`capacity` were added, every such extension is a
  small, real, cumulative expansion of Core's API surface that has to
  be kept consistent going forward — not a cost unique to this
  addition, but one this ADR incurs like the two before it.
- `size` and `capacity` are similarly named for genuinely different
  concepts (current vs. maximum); this ADR's "size vs. capacity"
  section exists specifically because that similarity is a plausible
  source of confusion for a future reader who encounters one without
  the other.
