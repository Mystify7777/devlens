# 0004: Event Store

## Status

Accepted

## Decision

The Event Store is intentionally minimal: `add`, `clear`, `getAll`,
`getByCategory`, `find`, `subscribe`, `destroy`. It gets history for free
by subscribing to the Event Bus with `{ replay: true }` at creation time,
and stays live for future events through the same subscription.

## Explicitly out of scope (belongs to the Bus, not here)

- ID generation
- Timestamp assignment
- Middleware
- Its own replay mechanism (reuses the bus's)

## Design notes

- Backed by `RingBuffer` like the bus, but with a much larger default
  capacity (`DEFAULT_STORE_SIZE` = 10,000 vs. the bus's `DEFAULT_REPLAY_BUFFER_SIZE`
  = 1,000) — the Store is meant to be the longer-lived queryable log a
  Panel/plugin reads from, not just dispatch-continuity plumbing.
- `find()` and `getByCategory()` both return arrays (all matches), kept
  consistent rather than having `find` return a single result — avoids an
  inconsistent "one returns many, one returns one" API.
- `clear()` only clears the Store's own buffer; it does not affect the
  bus's replay buffer or history. The two are independent logs that
  happen to be fed by the same source.
  - The Store no longer takes an `EventBus` in its constructor. Originally
  it self-subscribed to a bus on creation, which coupled storage to one
  specific event source. Now `createEventStore()` takes only
  `EventStoreOptions`, and wiring to a bus is a separate, explicit step
  via `connectStoreToBus(bus, store, options)` (`store-bus-connector.ts`).
  This means a future source — a WebSocket stream, an imported session
  file — can feed the exact same Store without the Store changing at all.
- `find()` renamed to `filter()`. "find" carries a strong single-result
  connotation in JS (`Array.prototype.find`); `filter()` matches actual
  behavior (returns all matches) without fighting developer intuition.

## Deferred (tracked, not built)

- Event validation (`assertValidEvent`) at the point events enter the
  system — noted again in review, still deferred until a concrete
  malformed-input case exists to validate against.
- Batch ingestion (`addMany`) — noted as worth designing room for once a
  bulk-import use case (e.g. importing a saved session) actually exists.
  Current single-event `add()` doesn't block adding this later.

## Future consideration

If a second connector type emerges (WebSocket, imported session, worker),
consider converging on a shared `EventSource` contract
(`{ subscribe(handler): () => void }`) so `connectStore(source, store)`
works generically. Not built now — one implementation doesn't justify
an interface.
