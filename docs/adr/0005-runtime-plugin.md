# 0005: Runtime Plugin

## Status

Accepted

## Decision

`@devlens/runtime` exports `createRuntimePlugin(bus)`, exposing exactly two
methods: `install()` and `uninstall()`. It captures global browser error
events and unhandled promise rejections via `addEventListener`, normalizes
them into `DevLensEventInput`, and calls `bus.report()`. Nothing else.

## Scope answers

1. **Public API**: `createRuntimePlugin(bus): { install(); uninstall() }`.
   No granular `listenErrors()`/`listenPromises()` — too fine-grained for
   a plugin whose entire job is "capture runtime failures."
2. **Browser APIs covered in v0**: global `error` events and
   `unhandledrejection` events only. Worker errors and iframe errors are
   explicitly out of scope until a concrete need appears.
3. **Attachment mechanism**: `window.addEventListener("error"/"unhandledrejection", ...)`,
   NOT `window.onerror = fn`. Assigning `window.onerror` directly overwrites
   any handler the host app (or another plugin) already set. addEventListener
   composes with existing listeners instead of replacing them — a debugging
   tool that silently deletes the host app's own error handling would be a
   serious defect, not a minor implementation detail.
4. **Non-goals**: console interception, fetch/network interception, React
   error boundaries, performance observation, compiler diagnostics — all
   separate packages per the roadmap.

## Consequences

- `install()`/`uninstall()` are idempotent — calling either twice in a row
  is a no-op, not an error or a duplicate registration.
- Normalization is centralized in `handlers/normalize.ts` so `on-error.ts`
  and `on-unhandled-rejection.ts` — which receive structurally different
  payloads — converge on the same `DevLensEventInput` shape before
  `bus.report()` is ever called.

## Amendment (this session)

Reorganized by responsibility rather than browser event name:
`listeners/{error-listener,unhandled-rejection-listener}.ts` +
`normalizers/runtime-normalizer.ts`, instead of `handlers/on-*.ts`. Scales
better once worker/iframe listeners exist — they'll reuse the same normalizer.
