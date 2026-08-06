# DevLens

A framework-agnostic, embeddable developer diagnostics panel.

DevLens unifies runtime errors, console activity, and (soon) network
requests into a single normalized event stream, displayed live in an
overlay you drop into any running app — no build config and no framework
dependency required for the core engine.

> **Engine first. UI second. Everything else is a client.**
>
> Runtime and Console capture events. The Event Store retains them. The
> Panel is just one consumer of that Store — a React wrapper, a CLI, or
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
- 350 test cases across the suite (`pnpm test` to run them)
- Every architectural decision recorded as an ADR before implementation

---

## Status

```text
Core          ✅  complete, tested
Runtime       ✅  complete, tested
Console       ✅  complete, tested
Playground    ✅  working
Panel         ✅  complete, tested
Network       ⏳  not started
React         ⏳  not started
```

DevLens already provides a complete end-to-end event pipeline:

- **Runtime** captures browser failures (`window.error`, unhandled rejections)
- **Console** captures console activity, without ever suppressing native output
- **EventBus** distributes normalized events synchronously
- **EventStore** retains them, decoupled from the Bus
- **Panel** renders them live, inside a Shadow DOM overlay

All of it is exercised end-to-end in `apps/playground`.

---

## How it fits together

```text
Runtime  ─┐
Console  ─┼─▶  EventBus  ─▶  EventStore  ─▶  Panel
Network* ─┘                                 (renders only,
                                              never captures)
```

\* not yet implemented

- **Capture** packages (`runtime`, `console`, and eventually `network`)
  are Plugins that observe browser behavior and `bus.report()` normalized
  events.
- The **Event Bus** is a synchronous, dependency-free dispatcher — no
  async, no priority, no bubbling.
- The **Event Store** is a plain data structure, deliberately decoupled
  from the Bus, so other sources (e.g. an imported session, a WebSocket)
  could feed it later.
- The **Panel** only reads from the Store. It never captures events
  itself — that separation is one of the project's core architectural
  decisions.

Every capture mechanism implements the same minimal contract:

```ts
interface Plugin {
  install(): void;   // idempotent
  uninstall(): void; // idempotent
}
```

---

## Packages

| Package | Description | Status |
|---|---|---|
| [`@devlens/core`](./packages/core) | Event model, Event Bus, Event Store, Plugin contract | ✅ |
| [`@devlens/runtime`](./packages/runtime) | Captures `window.error` / `unhandledrejection` | ✅ |
| [`@devlens/console`](./packages/console) | Intercepts `console.log/info/debug/warn/error` | ✅ |
| [`@devlens/panel`](./packages/panel) | Shadow-DOM overlay that renders events live | ✅ |
| `@devlens/network` | Captures network requests/failures | ⏳ planned |
| `@devlens/react` | React wrapper around the Panel | ⏳ planned |

### `apps/playground`

A minimal Vite app wiring Core + Runtime + Console + Panel together, used
to manually verify the whole pipeline. It is intentionally not a demo
app — just enough UI (a handful of buttons) to trigger each capture path
and watch a row appear in the Panel overlay.

---

## Getting started

Requires [pnpm](https://pnpm.io) and a recent Node.js.

```bash
pnpm install
pnpm build      # builds all packages (packages currently import from dist/)
pnpm --filter @devlens/playground dev
```

Open the printed local URL. Click the buttons to trigger a thrown error,
an unhandled rejection, and each console method — each should produce a
live row in the DevLens overlay.

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
`docs/adr/0009-v0.3.0-direction.md`, Option A, Accepted). Export/import
here means exporting a session as JSON; import itself is still out of
scope, deliberately not designed ahead of a real consumer.

Not yet committed to — this is a proposed direction, open for
discussion rather than a locked sequence:

- Network capture (`@devlens/network`)
- Import for previously-exported sessions
- React wrapper around the Panel (`@devlens/react`)

---

## Monorepo layout

```text
devlens/
├── docs/adr/           architectural decision records
├── packages/
│   ├── core/           event bus, store, plugin contract
│   ├── runtime/        window.error / unhandledrejection capture
│   ├── console/        console.* interception
│   └── panel/          Shadow-DOM overlay renderer
├── apps/
│   └── playground/     manual end-to-end verification app
├── DESIGN.md
└── package.json         pnpm workspace root
```

Tooling is deliberately minimal: plain pnpm workspaces (no Turborepo),
no ESLint/Prettier/Husky yet — both postponed until the package count
and contributor surface actually justify them.

---

## License

Not yet decided / no license file has been added. Treat this repository
as all-rights-reserved until a `LICENSE` file is added.
