# 0007: Console Plugin

## Status

Accepted

## Scope

v1 intercepts exactly: `console.log`, `console.info`, `console.warn`,
`console.error`, `console.debug`. Explicitly deferred: `table`, `group`,
`groupCollapsed`, `groupEnd`, `time`, `timeEnd`, `trace`, `clear`, `assert`.

## Severity mapping

| Console method | DevLens severity |
| -------------- | ---------------- |
| log            | info             |
| info           | info             |
| debug          | debug            |
| warn           | warn             |
| error          | error            |

## Category

Always `"console"`.

## Origin

Matches the actual method invoked: `"console.log"`, `"console.info"`,
`"console.warn"`, `"console.error"`, `"console.debug"` — not
`"console-listener"` or similar. Same reasoning as the Runtime `origin`
fix: origin should describe the semantic source, not the internal file
that captured it.

## Message extraction

No blanket stringify-everything-into-one-blob. Convention:

- `title`: fixed per method (e.g. "Console Error", "Console Log")
- `message`: the first argument, coerced to a readable string if it
  isn't already one (numbers/booleans via `String()`; objects via a
  best-effort `JSON.stringify`, falling back to `String()` if that throws
  — using the same best-effort serialization strategy already
  established in Runtime for unhandled rejection reasons)
- `metadata.args`: the full, untouched original arguments array,
  preserved as structured data, not stringified. Downstream consumers
  (Panel, a future object inspector) get the real objects, not a lossy
  string rendering of them.

## Preserve original behavior (non-negotiable)

Order of operations: **call the original console method first**, then
attempt to report. Rationale: console output should never fail to
appear because of a DevLens-internal problem. If `bus.report()` throws
(e.g. bus was destroyed), the wrapper catches and silently discards that
error rather than propagating it out of `console.log()` — this is a
deliberate, narrow exception to Core's "fail loudly" philosophy
(`EventBusDestroyedError` etc.): a diagnostics tool crashing the
application's own `console.error` call would be a worse outcome than
silently missing one telemetry event.

## Installation lifecycle

Identical shape to Runtime: `createConsolePlugin(bus): Plugin` —
`install()`/`uninstall()`, both idempotent. During `install()`, original
method references are captured per-instance before any wrapping happens.
During `uninstall()`, each method is restored to the exact captured
reference — not a generic "recreate console.log" but the literal
original function, so any pre-existing wrapping (from another tool) is
preserved rather than clobbered.

## Recursion strategy (the one substantial risk Runtime never had)

### The failure mode

console.error("boom")
→ interceptor calls original console.error (visible output)
→ interceptor calls bus.report(...)
→ EventBus dispatches synchronously to subscribers
→ some subscriber does console.log(event) for visibility
→ THIS console.log call gets intercepted too
→ reports again → dispatches again → ... (unbounded)
This only requires one subscriber, anywhere in the system (including a
future DevLens-internal one), that logs to console in response to an
event. Given the Event Bus is synchronous by design (ADR-0002), this
isn't a hypothetical edge case — it's a structural consequence of two
already-accepted decisions colliding.

### Decision: a per-instance reentrancy guard around report(), not around the original call

```ts
let isDispatching = false;

function wrap(method, severity) {
  return (...args) => {
    original[method](...args); // always runs, unconditionally
    if (isDispatching) return; // guard only wraps the dispatch step
    isDispatching = true;
    const event = normalize(method, severity, args); // unguarded — bugs here should surface
    try {
      bus.report(event);
    } catch {
      // Preserve host console behavior by suppressing failures
      // originating from the Event Bus.
    } finally {
      isDispatching = false;
    }
  };
}
```

Two things worth being explicit about:

- The guard wraps **only** the `bus.report()` call, not the passthrough
  to the original method. A `console.log` called reentrantly from inside
  a subscriber still prints normally — it just doesn't trigger a second
  `report()`. This preserves visible console output at every level of
  nesting; it only breaks the reporting cycle, not the logging itself.
- This guard is per-plugin-instance state (`isDispatching`, naming the
  synchronous dispatch cycle explicitly rather than "reporting" in some
  generic sense — DevLens may report to other destinations later, and
  this guard is specifically about the Event Bus's dispatch, not about
  reporting-in-general), not global — two separate
  `createConsolePlugin()` instances don't interfere with each other's
  reentrancy tracking.
- The catch boundary is deliberately narrow: it exists to swallow
  operational failures from `bus.report()` (e.g. a destroyed bus), not
  to hide bugs in event normalization. When implemented, the try block
  should wrap the report call itself, not the normalization step that
  precedes it.

## Explicitly deferred past v1

- Console groups (`group`/`groupEnd`) and timers (`time`/`timeEnd`) —
  no concrete consumer need yet.
- `console.table`, `console.trace`, `console.assert`, `console.clear`.
- Detecting/warning about a _different_ library also wrapping the same
  console method (double-wrapping across tools, not within DevLens) —
  Runtime's idempotency guard prevents DevLens double-wrapping itself,
  but conflicts with third-party console-patching tools are out of
  scope for now.

## Package structure

```text
packages/console/
└── src/
    ├── interceptors/
    │   └── console-interceptor.ts   (single factory, not one file per method)
    ├── normalizers/
    │   └── console-normalizer.ts
    ├── console.ts
    ├── index.ts
    └── types.ts
```

Deviates from the originally proposed `interceptors/{log,warn,error,...}.ts`
per-method file split: the five methods differ only in method name and
severity, so a single factory (`createInterceptor(bus, method, severity)`)
called five times avoids five near-identical files drifting out of sync.

## Future considerations (not solved in v1)

- **Object snapshotting vs. live references.** `metadata.args` stores a
  reference to whatever objects were logged, not a deep copy. If the
  logged object is mutated after the fact, a later-rendering consumer
  (e.g. the Panel) will show its current state, not its state at
  logging time — mirroring a well-known Chrome DevTools console
  behavior that regularly confuses developers. This is intentionally
  deferred until a real consumer of `metadata.args` exists (the Panel),
  since snapshotting strategy (deep clone? structuredClone? leave as
  live reference?) depends on how that consumer actually wants to use
  the data. Recorded here so this isn't mistaken for an oversight later.

## Amendment (Issue #19): non-interference for `metadata.args`

The "Object snapshotting vs. live references" entry above frames live
references purely as a value-staleness question. That framing is
correct as far as it goes — confirmed directly against Mozilla's own
bug tracker (bugzilla #754861, #1033031): both Chrome and Firefox
intentionally keep live references to logged objects, not snapshots,
and a request to change this was filed and closed as a duplicate of
the accepted behavior — but it is incomplete. It did not anticipate
that Core's `deepFreeze()` (ADR-0002), applied uniformly to every
reported event's metadata, would recursively freeze whatever object
graph `args` points to, including objects the logging code still holds
a live reference to and expects to keep mutating. Native browser
consoles never do this — their live-reference behavior risks showing a
stale value later, but never breaks the caller's own code. This
package's prior behavior was strictly worse than the precedent it was
already citing.

**Panel is an existing consumer of event metadata; it is not evidence
that snapshotting is required.** It renders whatever value is present,
generically, via `JSON.stringify()` at render time (see
`packages/panel/src/components/inspector.ts`) — it has no dependency
on point-in-time capture either way. The actual trigger for this
amendment was Core's own general freezing behavior conflicting with
this package's live-reference contract, discovered by inspecting
`deepFreeze()` and this package's normalizer together, not any request
from Panel.

A second, independent non-interference problem was found alongside
the freezing one: `deepFreeze()` reads each property via direct value
access (`value[key]`), which invokes getters rather than merely
inspecting descriptors. An object with a `get` accessor passed to
`console.log` previously had that accessor's code executed as a side
effect of reporting — at a time and in a context the caller never
chose. The fix below resolves both problems with the same mechanism,
since both stem from the same recursive traversal.

**Decision**: `metadata.args` remains exactly what it always was — the
real, live, unmodified argument array, same identity, same elements.
`EventBus.report()` accepts an optional, public, generic
`externallyOwned?: unknown[]` field on `DevLensEventInput` (Core, not
Console-specific): specific value references that must not be frozen
or traversed during reporting. `deepFreeze()` itself is unchanged — the
exemption reuses its existing cycle-guard `seen` parameter, seeded once
before middleware runs and never exposed to middleware or present on
the resulting event. This package sets `externallyOwned: [args]` in
its normalizer — the array reference alone, not its individual
elements — which is sufficient, since `deepFreeze` returns before
recursing once it finds a `seen` match, protecting everything reachable
beneath that one reference for free.

The exemption is identity-based, not path-based: an exempted value
remains unfrozen everywhere it's reachable in the final event,
including through property paths other than where it was originally
declared. This is not a limitation to work around — it is a structural
consequence of how `Object.freeze()` works (it freezes an object, not
a path to one), and any path-based alternative would have been
fragile, since its correctness would depend on which path a shared
reference happened to be visited through first.

This package is the first, and as of this amendment the only,
consumer of `externallyOwned`. The field's own specification makes no
reference to Console and requires none to be understood or reused
correctly by a future plugin with a genuinely equivalent need.

**Remains explicitly deferred**: snapshotting/cloning semantics for
`metadata.args` — this amendment makes the non-interference bug moot,
it does not answer the staleness question the original entry above
raised, and that question should stay open until a real, concrete
consumer need for point-in-time values is demonstrated. Extending
`externallyOwned` usage to any plugin other than Console remains
undone — no second real consumer exists yet.

## Amendment (Issue #22): `stack` derivation from multi-argument calls

The original "Message extraction" section did not specify `stack`.
Before this amendment, `stack` was populated only when `args[0]` was an
`Error`, so `console.error("failed", err)` lost `err.stack` from the
primary field (it remained available via `metadata.args`).

**Decision**: `message` and `title` are unchanged — `message` remains
derived from the first argument only. `stack` is derived as follows:

1. If `args[0] instanceof Error`: `stack = args[0].stack`. This is
   authoritative, including when the value is `undefined` or empty;
   later arguments are never consulted. Message and stack always refer
   to the same Error.
2. Otherwise: `stack` is the first `Error` in `args[1..]` (by position)
   whose `stack` is a non-empty string. Later Errors without a usable
   stack are skipped. If none qualify, `stack` is `undefined`.

Detection is identity-based (`instanceof Error`), never duck-typed:
`{ message, stack }` objects do not count, and no property of a
non-Error argument is read (so arbitrary getters are never invoked).
Consequently, Errors from another realm (which fail `instanceof`) are
not recognized, in the first-argument case as before.

`metadata.args` and `externallyOwned` behavior (Issue #19) is
unchanged: the original array is preserved by reference; no argument is
cloned, mutated, or frozen.
