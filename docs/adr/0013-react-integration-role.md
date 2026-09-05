# 0013: React Integration Role

## Status

Accepted. This ADR records the architectural decision only —
`packages/react` does not exist yet, and ADR-0006, ADR-0008, and
ADR-0009 (which this decision requires amending) remain unmodified as
of this writing; amending them and implementing the package are
separate, later steps.

## Context

`@devlens/react` has appeared on this project's roadmap since ADR-0009
named it as the fourth item on the Capture axis (Runtime, Console,
Network, React), but its intended role was never settled — and, on
inspection, is actively contradicted across the existing documentation
rather than merely unspecified:

- **ADR-0006** (Plugin Contract) states "Console, Network, and React
  should each export `create*Plugin(bus): Plugin`" — a **capture
  plugin** framing, identical in shape to Runtime/Console/Network.
- **ADR-0008** (Panel) states "if a React-specific experience is
  wanted later, `@devlens/react` should wrap the Panel, not replace
  it" — a **Panel-wrapper** framing.
- **ADR-0009** contains both framings _in the same document_: its
  Capture-axis table places React alongside Runtime/Console/Network,
  while its own "Explicitly deferred" section separately calls it a
  "React wrapper... depends on Panel's public surface." This is an
  internal self-contradiction, not just a cross-document one.
- **README.md** twice describes it as "a React wrapper around the
  Panel," consistent with ADR-0008, not ADR-0006.

No code has ever been written in either direction — zero commits in
this repository's history touch anything under a `react` path.

**External evidence check (this ADR's own required step before being
written): GitHub Issue #4, "Implement @devlens/react."** Inspected in
full — body, labels, comments, linked issues/PRs. The issue body reads
"No description provided." It carries exactly one label (`react`, a
generic package-category label, not descriptive of role), no comments,
no linked issues or pull requests, and no assignee. **This issue
provides no corroboration or contradiction for either interpretation**
— its existence confirms only that a React integration was anticipated
at project inception, which was already known from ADR-0009 and never
in dispute. The decision below rests entirely on the internal
ADR/code evidence and the React-platform evidence discussed below, not
on this issue.

## Decision

`@devlens/react` will be a **client-only, error-boundary-based capture
mechanism** — the same category of thing Runtime, Console, and Network
already are, observing a genuinely React-specific signal and reporting
it through the existing `EventBus`, exactly like the other three.

### The non-redundant capability: `componentStack`, specifically in production

React error boundaries (`componentDidCatch(error, errorInfo)` /
`static getDerivedStateFromError(error)`) receive
`errorInfo.componentStack` — a string identifying the component-tree
location of a failure, categorically different information from a JS
call-stack trace and unavailable from any other API.

This alone would not justify a dedicated package: `@devlens/console`
already preserves a call's **entire, untouched argument list** as
`metadata.args` in its normalizer, so if React (or the host
application) passes a component stack to `console.error`, Console
already captures it today, with zero React-specific code. What
changes this conclusion is a documented, long-standing React platform
behavior: **React deliberately minifies its own console error output
in production builds** (numeric error codes plus a link to a decoder
page, not full messages or component stacks), to reduce production
bundle/log size. `errorInfo.componentStack`, by contrast, is **not
minified** — it is the real, full value, in every build mode, because
it is a direct API contract rather than console output.

**The concrete, falsifiable gap this closes**: an application whose
`componentDidCatch` does not itself explicitly log the full component
stack (e.g., one that forwards errors straight to analytics/telemetry
instead) has that caught error invisible to DevLens today, in every
build mode, through every existing package — not an uncaught
`window.error` (Runtime's domain), and not a `console.error` call
carrying useful detail (Console's domain, defeated by React's own
production minification). Only a mechanism with direct access to the
error boundary API can recover this.

### Structural shape: a component, not a `Plugin`

Unlike Runtime/Console/Network, this mechanism has no global to patch
or listener to attach — a React error boundary is a component,
mounted and unmounted by React itself as part of the normal render
tree. It therefore does not need, and should not be forced into,
the literal `Plugin` interface (`{ install(): void; uninstall(): void
}`) that ADR-0006 prescribes for it. The proposed shape is directional,
not a final design (per this ADR's own scope): something like
`createDevLensErrorBoundary(bus: EventBus): React.ComponentType`,
calling `bus.report()` directly from `componentDidCatch`, with
`errorInfo.componentStack` carried as metadata — mirroring how
Network's `CapturedRequest` → `normalizeNetworkEvent()` seam already
separates "browser-specific capture" from "normalized event"
(ADR-0010).

### Rejected: Panel-wrapper interpretations

Two distinct versions of "React wrapper around the Panel" were
evaluated against `PanelController`'s actual public surface (`install`,
`uninstall`, `setFilters`, `setSearchQuery`, `pause`, `resume`,
`clear`, `exportEvents`, `isPaused` — confirmed exhaustively; no query
or subscription exists for Panel's own internal UI state such as
current filters or current selection):

- **Lifecycle-only** (call `panel.install()`/`uninstall()` at the
  right React lifecycle moments): works today with zero Panel changes,
  but is thin enough that a developer could write it inline in a few
  lines without needing a published package — marginal value, not
  rejected as _wrong_, but not chosen as _this_ package's role.
- **Reactive state adapter** (expose Panel's filters/selection/pause
  state as React state/hooks): would provide real value, but requires
  Panel API additions — a subscription mechanism for UI state — that
  do not exist today and are not justified by any second real
  consumer. Building this now would repeat exactly the kind of
  premature abstraction this project has repeatedly and explicitly
  rejected elsewhere (`assert.ts`/`now()` in Core; `getByCategory`/
  `filter` remaining unused since their introduction).

Neither version is adopted by this ADR. The reactive-adapter version
is not rejected forever — see Scope, below — only deferred pending its
own evidence.

### Rejected: both roles under one package

No evidence — internal or external — was found of a single consumer
needing both a capture mechanism and a Panel-state adapter at once.
The two solve unrelated problems. Combining them would also violate
this project's own repeated "don't force unrelated decisions
together" discipline, applied here to package structure.

### Runtime/environment contract: explicitly client-only

React Server Components execute exclusively on the server and
structurally cannot use lifecycle methods or hooks at all — an error
boundary must be a Client Component (`"use client"`) in any RSC-based
framework, and cannot catch or observe errors from Server Components
in the same render pass; those are handled by the framework's own
server-side mechanism (e.g., a routing convention's error page), a
different problem this ADR does not address. Traditional SSR
(`renderToString`/`renderToPipeableStream`) executes in Node.js, where
`window`/`document` do not exist.

This project already has a consistent, established pattern for this
exact situation — every existing capture/render package guards against
its assumed global being absent and no-ops rather than throwing:

```text
panel.ts:    if (typeof document === "undefined") return;
runtime.ts:  if (typeof window === "undefined") return;
console.ts:  if (typeof console === "undefined") return;
```

`@devlens/react`'s capture mechanism must follow the identical pattern
— guard against `typeof window === "undefined"` and no-op during SSR's
render pass, rather than assuming a browser environment unconditionally.
This is continuity with existing precedent, not a new constraint the
project is introducing for React specifically.

## Relationship to ADR-0006, ADR-0008, ADR-0009

This decision requires amending all three, following this project's
own established "amend explicitly, state what's being revised, don't
silently edit" precedent (as ADR-0011 did for capacity/addMany).
**None of the three is amended by this ADR itself** — that is a
separate, later step:

- **ADR-0006**: its specific claim that React should export
  `create*Plugin(bus): Plugin` needs correcting — both the role
  (confirmed: capture, not Panel-wrapper) and the literal interface
  shape (a component, not a `Plugin`-shaped factory, per the
  structural finding above).
- **ADR-0008**: its "React should wrap the Panel, not replace it" line
  needs amending or explicitly rescoping — this ADR finds that framing
  applies only to the deferred, not-currently-justified reactive-
  adapter interpretation, not to what's actually decided here.
- **ADR-0009**: its internal self-contradiction (Capture-axis table
  vs. "React wrapper" in Consequences) is resolved in favor of the
  Capture-axis placement — its own "Explicitly deferred" text needs
  correcting to match.

## Scope boundaries (explicitly not part of this decision)

- **The reactive Panel-state adapter** — not ruled out permanently,
  but requires its own future research establishing a real consumer
  need for Panel-level UI-state subscription before being built. Not
  designed, scoped, or scheduled by this ADR.
- **React Server Components instrumentation** — structurally
  impossible for a `componentDidCatch`-based mechanism; explicitly a
  non-goal, not a silently missing case.
- **SSR-side error capture** — a different problem (arguably closer to
  Runtime's domain, server-side) than this ADR addresses; the client-
  only mechanism decided here does not attempt it.
- **Any Core or `EventStore` change** — `bus.report()` is already
  sufficient; nothing here implies a Core change.
- **Any `EventCategory` expansion** — the existing open-string hybrid
  type already accommodates a new category value with zero Core
  change, exactly as it did for Network.
- **Any Panel rendering change** — Panel's category-agnostic rendering
  is already proven sufficient (confirmed against a synthetic
  `category: "network"` event; the same proof extends to a React-
  originated category without further Panel work).
- **The exact public API** (function/component name, prop shape,
  export structure) — directional only, per this ADR's own framing;
  final design is implementation work, not decided here.

## Consequences

### Positive

- Closes a genuine, concrete, previously-undocumented blind spot:
  caught React errors with no explicit developer-side logging are
  invisible to DevLens today, in every build mode, through every
  existing package.
- Extends the Capture → EventBus → EventStore → Panel boundary one
  step further than any prior milestone — the first capture source
  observing a library's internal lifecycle (error boundaries) rather
  than a browser platform primitive, testing the architecture's
  generality at a new point without requiring any change to that
  architecture.
- Resolves a three-document contradiction (ADR-0006 vs. ADR-0008 vs.
  ADR-0009's own internal inconsistency) that has stood, unaddressed,
  since ADR-0009 was accepted.

### Negative

- `@devlens/react` will not be a `Plugin` in the literal interface
  sense ADR-0006 originally promised, which is itself a small,
  necessary correction to that ADR rather than a cost-free outcome —
  ADR-0006's text was simply wrong about this one package's shape.
- The reactive Panel-state adapter — the more ambitious, arguably more
  broadly useful version of "React integration" — is explicitly
  deferred, not delivered. Developers expecting a full React
  embedding of Panel's UI state will not get it from this milestone.
- Client-only scope means React Server Components users get no
  DevLens coverage for that execution context; this should be stated
  plainly in documentation once implemented, not discovered by a
  confused user.

## What would falsify this decision

- Evidence that a real application's error boundaries reliably log
  the full component stack to `console.error` even in production
  (contradicting the general React minification behavior this
  decision rests on) — would weaken the core non-redundancy claim.
- Concrete evidence of real demand for a reactive Panel-state adapter
  strong enough to justify the Panel API work it requires — would
  argue for revisiting the deferred interpretation, not necessarily
  reversing this one.
- A change to React's own error-boundary API (e.g., function-component
  error boundaries, or a change to `componentStack`'s availability or
  format) — the "React minifies production console output but not
  `errorInfo`" fact is load-bearing here; if it stops being true, this
  decision's justification should be revisited.

## Is a dedicated spec warranted?

No. Runtime, Console, and Network — the three existing capture
mechanisms — were each specified via ADR plus inline code
documentation plus tests, never a separate spec file. This decision
places `@devlens/react` in that same category, not in Inspection/
Session-Import's multi-decision, spec-warranting category.
