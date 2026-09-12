# 0014: Lint policy

## Status

Accepted. `pnpm lint` (root `package.json`) has been removed; no
package defines a `lint` script.

## Context

The root `package.json` advertised `"lint": "pnpm -r lint"`, and
`README.md` listed `pnpm lint` alongside `build`/`test`/`clean` as a
normal, working root script. In fact no package in the current
workspace defines a `lint` script. Every invocation of `pnpm lint`
fails immediately with `ERR_PNPM_RECURSIVE_RUN_NO_SCRIPT`.
This surfaced during Issue #13's release-verification pass and was
deliberately left unresolved there, since deciding lint policy was
out of that issue's scope.

## Decision

**No dedicated lint tool (ESLint or otherwise) is added.** The broken
`lint` script is removed rather than fixed by adding a tool.

This is not "TypeScript projects don't need linting" as a general
claim — it's specific to what this repository's existing quality
mechanisms already cover, checked concretely rather than assumed:

| Concern a lint tool might catch                                                                      | Already covered by                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Type errors, unsafe `any` usage, unreachable code                                                    | `strict: true` in every package's `tsconfig.json`                                                                                                                                                                                                                                                                                                                      |
| Behavioral regressions                                                                               | Workspace test suite (`pnpm test`)                                                                                                                                                                                                                                                                                                                                     |
| Stylistic consistency (quotes, semicolons, line length)                                              | Prettier                                                                                                                                                                                                                                                                                                                                                               |
| Trailing whitespace, conflict markers                                                                | `git diff --check`                                                                                                                                                                                                                                                                                                                                                     |
| Unused variables/imports                                                                             | **Not covered today** — `noUnusedLocals`/`noUnusedParameters` are off in every `tsconfig.json`. Enabling those two compiler flags would close this gap at zero new-dependency cost if it ever becomes a real problem; this ADR does not enable them, since doing so risks failing the build on existing code and is a separate decision from removing a broken script. |
| React hooks rules (rules-of-hooks, exhaustive-deps)                                                  | **Not covered today.** Real, TypeScript-uncoverable gap — but the entire surface it would apply to is one file (`apps/playground/react-demo.tsx`; `@devlens/react`'s own `error-boundary.tsx` is a class component and doesn't use hooks). Disproportionate to justify a new tool/config/dependency for.                                                               |
| Architectural boundary violations (e.g. React imports leaking into `@devlens/core`/`@devlens/panel`) | Verified manually via targeted `grep` during Issue #13 and Issue #14's investigations — clean both times. No violation has ever actually occurred in this project's history; there is no repeated pain to automate away.                                                                                                                                               |

This follows the same standard this project has applied consistently
elsewhere: `assert.ts` and `now()` (Core), and a dedicated
`RuntimePlugin` type, were each built and then deliberately deleted
for lacking a second real consumer; the classifier duplication between
`fetch-outcome.ts`/`xhr-outcome.ts` is deliberately left unextracted
pending a third real consumer; the reactive Panel-state adapter
(Issue #14) was investigated and closed without implementation for
the same reason. Adding ESLint here — a tool with real, ongoing
configuration, dependency-maintenance, and CI-time cost — without a
concrete, current problem it solves would be the same anti-pattern
applied to tooling instead of application code.

## What would change this decision

Per the same falsification-condition pattern ADR-0013 established:

- A second file starts using React hooks in a way exhaustive-deps
  would have caught a real bug in.
- An architectural boundary this project cares about (React isolation,
  Plugin contract shape, Panel/capture separation) is actually
  violated in a real PR, not just checked and found clean.
- Unused-variable buildup becomes a real, recurring code-review
  complaint — in which case enabling `noUnusedLocals`/
  `noUnusedParameters` is very likely sufficient on its own and should
  be tried before reaching for a dedicated lint tool.

Any of these would be concrete evidence, not a generic "we should
probably have linting" impulse — the same bar this project has held
every other tooling/abstraction decision to.

## Consequences

### Positive

- `pnpm lint` no longer exists to fail. The workspace's advertised
  commands (`build`, `test`, `clean`, `format`, `format:check`) all
  work exactly as documented.
- No new dependency, configuration surface, or CI time added.

### Negative

- The two real, identified gaps (unused vars, hooks rules) remain
  genuinely uncovered until either recurs as an actual problem.
- A future contributor unfamiliar with this project's tooling
  philosophy may expect a lint command to exist and be surprised it
  doesn't; this ADR is the answer to "why not."
