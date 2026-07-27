# 0007: Console Plugin

## Status

Accepted

## Scope

v1 intercepts exactly: `console.log`, `console.info`, `console.warn`,
`console.error`, `console.debug`. Explicitly deferred: `table`, `group`,
`groupCollapsed`, `groupEnd`, `time`, `timeEnd`, `trace`, `clear`, `assert`.

## Severity mapping

| Console method | DevLens severity |
| ------- | ------- |
| log | info |
| info | info |
| debug | debug |
| warn | warn |
| error | error |

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
  — same pattern already established in Runtime's `describeReason`)
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
let isReporting = false;

function wrap(method, severity) {
  return (...args) => {
    original[method](...args);       // always runs, unconditionally
    if (isReporting) return;         // guard only wraps the report step
    isReporting = true;
    try {
      bus.report(normalize(method, severity, args));
    } catch {
      // swallow — see "preserve original behavior" above
    } finally {
      isReporting = false;
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
- This guard is per-plugin-instance state, not global — two separate
  `createConsolePlugin()` instances (unusual, but not disallowed) don't
  interfere with each other's reentrancy tracking.

## Explicitly deferred past v1

- Console groups (`group`/`groupEnd`) and timers (`time`/`timeEnd`) —
  no concrete consumer need yet.
- `console.table`, `console.trace`, `console.assert`, `console.clear`.
- Detecting/warning about a *different* library also wrapping the same
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
