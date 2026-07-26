# 0002: Event Bus

## Decision

The Event Bus is synchronous, with lightweight middleware, category/wildcard
subscription filtering, and optional replay for late subscribers.

## Alternatives considered

- **Minimal (no middleware)**: rejected — every future cross-cutting concern
  (dedup, validation, persistence) would end up hardcoded inside `report()`.
- **Async dispatch**: rejected — nearly all events (console, runtime errors)
  are synchronous by nature; async plugins can opt in themselves via
  `queueMicrotask` inside their own handler.
- **Event priority / cancellation / bubbling**: rejected for v0.1 — no
  concrete use case yet; adding later is cheap, removing later is not.

## API surface (frozen for v0.1)

```ts
bus.report(input)
bus.subscribe(category | "*", handler, { replay? })  // returns unsubscribe fn
bus.unsubscribe(handler)
bus.use(middleware)
bus.clear()
bus.getEvents()
bus.destroy()
```

## Consequences

- Bus keeps a small bounded internal history buffer (default 1000) solely to
  support `replay` and `getEvents()`. This is NOT the full Event Store
  (no search, filtering, or pinning) — that's a separate consumer built next.
- Middleware signature is intentionally minimal: `(event, next) => void`.
  No Express-style app-level config, no ordering guarantees beyond registration order.

## Amendment (this session)

- ID generation isolated into `id.ts` (`generateEventId`) so the strategy
  can change (UUID v7, ULID, etc.) without touching the bus.
- Errors are typed (`EventBusDestroyedError`, `MiddlewareError`) in `errors.ts`
  rather than generic `Error` — clearer for consumers catching bus errors.
- Internal history variable renamed to `replayBuffer` to make explicit that
  this is dispatch-semantics plumbing, not the canonical event log. The
  upcoming Event Store is the source of truth for "what happened, ever";
  the bus only guarantees late subscribers don't miss recent events.
- Considered removing `getEvents()` in favor of replay-only access. Rejected:
  the Event Store needs to bootstrap its own state from *something* when it
  first subscribes, and `getEvents()` is that hook.
- Considered named middleware phases (`validation`, `enrichment`, `transform`)
  instead of plain registration-order middleware. Deferred past v0.1 — no
  concrete need yet, and the migration path (grouping `use()` calls under a
  phase) is non-breaking whenever we do need it.
- Replay buffer implemented as `RingBuffer<T>` (`collections/ring-buffer.ts`)
  instead of an array with `shift()` — O(1) push instead of O(n) per event.
- Every public method (`subscribe`, `unsubscribe`, `addMiddleware`, `clear`,
  `getEvents`) now guards against a destroyed bus, not just `report()`.
  `destroy()` itself is idempotent — calling it twice is a no-op, not an error.
- Published events are deep-frozen (`utils/deep-freeze.ts`) before dispatch,
  including nested `metadata`/`context`/`tags` — a subscriber mutating a
  nested field can no longer silently corrupt the replay buffer's copy.
- `DevLensEvent` fields are now `readonly`; a `MutableDevLensEvent` mapped
  type exists for internal middleware use only, so middleware may mutate
  in place OR return a new object via spread — both are supported, neither
  is mandated. (Considered forcing in-place mutation for allocation
  savings; rejected — event volumes here don't make that a real cost, and
  mandating a style over supporting one adds friction for no measured gain.)
- `use()` renamed to `addMiddleware()` — no consumers existed yet, so the
  rename was free. `EventMiddleware`'s signature is otherwise unchanged.
- `deepFreeze` now only recurses into plain objects and arrays, skipping
  built-in/host objects (Date, Map, Set, RegExp, Error, DOM nodes,
  functions) and guarding against cyclic references via a WeakSet. Prevents
  freezing arbitrary host objects a plugin might carelessly attach to
  `metadata`/`context`.
- Removed `utils/assert.ts` and `utils/timestamp.ts` — both were
  single-use abstractions with no second consumer. Will reintroduce when
  the Event Store (or another package) has a concrete need.
- `DEFAULT_HISTORY_SIZE` moved to `constants.ts` instead of an inline
  `1000`, since a second package (Store) will want the same default.
- `EventMiddleware`'s `next()` now accepts zero arguments (continue with
  the current, possibly mutated-in-place draft) in addition to a
  replacement event (spread style). Both styles remain supported —
  considered making mutate-in-place the *only* style, rejected: no
  concrete problem forces removing the spread style, and doing so would
  reverse an already-settled decision without new evidence.
- `RingBuffer` gained `forEach()`; replay no longer allocates an
  intermediate array via `toArray().filter()`.
  