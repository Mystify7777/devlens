# DevLens — Engineering Principles

This document is the project's compass. When a feature or PR is unclear,
check it against these principles before checking anything else.

1. **Engine first, UI second.** The event pipeline (bus, store) must work
   and be provably correct before any UI consumes it. The Panel is "just
   another subscriber" — never a special case the engine bends around.
2. **Everything is an event.** Runtime errors, console calls, network
   requests, compiler diagnostics — all normalized to `DevLensEvent`. No
   parallel data model gets introduced for a new signal type.
3. **Framework-agnostic by default.** `@devlens/core` has zero React/Vue/
   Vite dependencies. Framework support is a plugin, never a core concern.
4. **Plugins extend behavior; they do not modify core.** If adding a
   feature requires forking or patching `@devlens/core`, the plugin API
   is the thing that's broken — fix the API, not the rule.
5. **Public APIs change slowly.** Once an API ships in a release, breaking
   it is a last resort. Prefer additive changes; use ADRs to record why an
   API looks the way it does before locking it in.
6. **No feature without tests.** A milestone isn't done until its tests are
   green. Untested code is a liability, not progress.
7. **Composition over inheritance.** Small, focused units (event bus,
   ring buffer, store) that compose, rather than deep class hierarchies.

See `docs/adr/` for the reasoning behind specific decisions made under
these principles.