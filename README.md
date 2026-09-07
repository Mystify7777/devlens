# DevLens

A framework-agnostic, embeddable developer diagnostics panel.

DevLens unifies runtime errors, console activity, network requests,
and React component errors into a single normalized event stream,
displayed live in an overlay you drop into any running app — no build
config and no framework dependency required for the core engine.

> **Engine first. UI second. Everything else is a client.**
>
> Runtime, Console, Network, and React capture events. The Event Store
> retains them. The Panel is just one consumer of that Store — a CLI or
> a VS Code extension could just as easily read from the same Store.

<!--
  TODO: replace with a real screenshot of apps/playground once the
  Panel has real styling (styles.ts is still a placeholder). Rough
  target layout:

  +--------------------------------------------+
  |  DevLens Playground                         |
  |  [Throw Error] [console.log()] [...]        |
  |----------------- DevLens -------------------|
  |  ERROR  Uncaught Error       ...            |
  |  INFO   Console Log         ...             |
  |----------------------------------------------|
-->

---

## Features

- Framework-agnostic core — no React/Vue/etc. dependency to capture events
- Plugin-based capture architecture (`install()`/`uninstall()`, always idempotent)
- Normalized, versioned event model shared across every capture source
- Shadow-DOM-isolated overlay — no CSS collisions with the host app
- Zero runtime dependencies in `@devlens/core`
- 627 test cases across the suite (`pnpm test` to run them)
- Every architectural decision recorded as an ADR before implementation

---

## Status

```text
Core          ✅  complete, tested
Runtime       ✅  complete, tested
Console       ✅  complete, tested
Playground    ✅  working
Panel         ✅  complete, tested
Network       ✅  complete, tested (Fetch + async XHR)
React         ✅  complete, tested (client-only error-boundary capture)
```

DevLens already provides a complete end-to-end event pipeline:

- **Runtime** captures browser failures (`window.error`, unhandled rejections)
- **Console** captures console activity, without ever suppressing native output
- **Network** captures Fetch and asynchronous XHR requests, classified by outcome
- **React** captures component errors via an error boundary, reporting
  React's `componentStack` alongside the caught error (client-only —
  see ADR-0013)
- **EventBus** distributes normalized events synchronously
- **EventStore** retains them, decoupled from the Bus
- **Panel** renders them live, inside a Shadow DOM overlay

All of it is exercised end-to-end in `apps/playground`.

---

## How it fits together

```text
Runtime  ─┐
Console  ─┼─▶  EventBus  ─▶  EventStore  ─▶  Panel
Network  ─┤                                 (renders only,
React    ─┘                                  never captures)
```

- **Capture** packages (`runtime`, `console`, `network`, `react`) observe
  browser or component behavior and `bus.report()` normalized events.
- The **Event Bus** is a synchronous, dependency-free dispatcher — no
  async, no priority, no bubbling.
- The **Event Store** is a plain data structure, deliberately decoupled
  from the Bus, so other sources (e.g. an imported session, a WebSocket)
  could feed it later.
- The **Panel** only reads from the Store. It never captures events
  itself — that separation is one of the project's core architectural
  decisions.

Runtime, Console, and Network implement the same minimal `Plugin`
contract:

```ts
interface Plugin {
  install(): void; // idempotent
  uninstall(): void; // idempotent
}
```

`@devlens/react` deliberately does not — a React error boundary has no
global to patch, so its own React mount/unmount lifecycle is
sufficient (see ADR-0013 and its amendment to ADR-0006).

### `@devlens/react` usage

```tsx
import { createEventBus } from "@devlens/core";
import { createDevLensErrorBoundary } from "@devlens/react";

const bus = createEventBus(); // the same bus every other capture source reports through

const DevLensErrorBoundary = createDevLensErrorBoundary(bus);

function App() {
  return (
    <DevLensErrorBoundary fallback={<p>Something went wrong.</p>}>
      <YourApplication />
    </DevLensErrorBoundary>
  );
}
```

`fallback` is optional and entirely caller-owned — if omitted, the
boundary renders `null` on a caught error rather than any default or
styled UI. DevLens observes and reports; it never decides what your
users see.

Alongside the caught `Error`, the boundary reports React's own
`errorInfo.componentStack` — the component-tree location of the
failure. This is worth capturing specifically because React minifies
its own console error output in production builds, but
`componentStack` is a direct API value, not console output, so it
stays intact in every build mode (see ADR-0013 for the full reasoning).

`@devlens/react` captures **client-side React rendering errors only**.
Its reporting path is guarded when `window` is unavailable, so no
report is produced during server rendering. SSR and React Server
Components error capture are outside this package's scope.

---

## Packages

| Package                                  | Description                                                        | Status |
| ---------------------------------------- | ------------------------------------------------------------------ | ------ |
| [`@devlens/core`](./packages/core)       | Event model, Event Bus, Event Store, Plugin contract               | ✅     |
| [`@devlens/runtime`](./packages/runtime) | Captures `window.error` / `unhandledrejection`                     | ✅     |
| [`@devlens/console`](./packages/console) | Intercepts `console.log/info/debug/warn/error`                     | ✅     |
| [`@devlens/panel`](./packages/panel)     | Shadow-DOM overlay that renders events live                        | ✅     |
| [`@devlens/network`](./packages/network) | Captures Fetch and async XHR requests, classified by outcome       | ✅     |
| [`@devlens/react`](./packages/react)     | Client-only React error boundary reporting caught component errors | ✅     |

### `apps/playground`

A minimal Vite app wiring Core + Runtime + Console + Network + React +
Panel together, used to manually verify the whole pipeline. It is
intentionally not a demo app — just enough UI (a handful of buttons and
a small React component tree) to trigger each capture path and watch a
row appear in the Panel overlay.

---

## Getting started

Requires [pnpm](https://pnpm.io) and a recent Node.js.

```bash
pnpm install
pnpm build      # builds all packages (packages currently import from dist/)
pnpm --filter @devlens/playground dev
```

Open the printed local URL. Click the buttons to trigger a thrown error,
an unhandled rejection, each console method, a same-origin Fetch/XHR
request (success and 404 variants), and the React demo's "Throw inside
React component" button — each should produce a live row in the
DevLens overlay.

### Other root scripts

```bash
pnpm build   # pnpm -r build
pnpm test    # pnpm -r test
pnpm lint    # pnpm -r lint
pnpm clean   # pnpm -r clean
```

---

## Design principles

These are treated as settled unless implementation reveals a genuine
flaw — see `docs/adr/` before proposing changes that touch them:

- **Design before code.** Every package started as an ADR (scope, API,
  explicitly rejected alternatives) before any implementation.
- **No premature abstraction.** Utilities and generalizations are only
  introduced once a second real consumer justifies them — several were
  built and then deliberately deleted for lack of one.
- **Small, boring, composable files.** Pure normalizers, narrow
  try/catch blocks, no speculative optimization.
- **Plugins never throw into the host app**, and never suppress the
  host app's own behavior (e.g. Console's interceptor always calls the
  original `console.*` method first, unconditionally).
- **Tests are required before a package is considered done.**

See [`DESIGN.md`](./DESIGN.md) and [`docs/adr/`](./docs/adr) for the
full architectural history and reasoning behind each decision.

---

## Roadmap

Interactive inspection of captured events — inspector, filtering,
search, keyboard navigation, and the pause/resume/clear/export
operational layer — is complete (see `docs/specs/inspection.md` and
`docs/adr/0009-v0.3.0-direction.md`, Option A, Accepted). Session
Import is also complete: `importSession()` restores a previously
exported session into an empty `EventStore`, preserving original
`id`/`timestamp` and array order exactly (see
`docs/specs/session-import.md` and `docs/adr/0011-session-import.md`,
Accepted), and the Panel's own Session Restore UI (an Import button,
file picker, and status region alongside Export) is complete as well.
`EventStore.size` (`docs/adr/0012-eventstore-size.md`) exposes current
Store occupancy directly, replacing two internal `getAll().length`
workarounds.

`@devlens/react` is also complete: a client-only React error boundary
that reports caught component errors — including React's own
`componentStack` — through the same `EventBus` every other capture
source uses. It is **not** a Panel wrapper; see
`docs/adr/0013-react-integration-role.md` for why, and its amendments
to `docs/adr/0006-plugin-contract.md`, `docs/adr/0008-panel.md`, and
`docs/adr/0009-v0.3.0-direction.md` for the historical correction to
this project's earlier, contradictory documentation on React's role.

Not yet committed to — this is a proposed direction, open for
discussion rather than a locked sequence:

- Further Network capture metadata (URL normalization, Content-Type,
  response size — see `docs/research/network-capture.md`, Open Issues)
- A reactive Panel-state adapter for React (distinct from the
  error-boundary capture above) — deferred pending evidence of real
  demand; see `docs/adr/0013-react-integration-role.md`'s Scope
  boundaries.

---

## Monorepo layout

```text
devlens/
├── docs/adr/           architectural decision records
├── packages/
│   ├── core/           event bus, store, plugin contract
│   ├── runtime/        window.error / unhandledrejection capture
│   ├── console/        console.* interception
│   ├── network/        fetch/XHR interception, outcome classification
│   ├── panel/          Shadow-DOM overlay renderer
│   └── react/          client-only error-boundary capture
├── apps/
│   └── playground/     manual end-to-end verification app
├── DESIGN.md
└── package.json         pnpm workspace root
```

Tooling is deliberately minimal: plain pnpm workspaces (no Turborepo),
no ESLint/Husky yet — Prettier was added for formatting enforcement;
both ESLint and Husky remain postponed until the package count and
contributor surface actually justify them.

---

## License

Not yet decided / no license file has been added. Treat this repository
as all-rights-reserved until a `LICENSE` file is added.
