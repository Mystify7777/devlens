# 0004: Event Store

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

## Deferred (tracked, not built)

- Event validation (`assertValidEvent`) at the point events enter the
  system — noted again in review, still deferred until a concrete
  malformed-input case exists to validate against.
  