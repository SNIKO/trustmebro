# Generic Coding Rules

Apply when generating or modifying code.

## Priority (on conflict)
**Clarity → Simplicity → Maintainability → Modularity → Testability → Performance**

---

## Clarity
- One function = one job. Name it after what it does, not how.
- No abbreviations unless universally known (`id`, `url`, `err` OK; `mgr`, `proc` NOT OK).
- Avoid nesting >2 levels deep. Use early returns to flatten.
- Don't comment what code does — rename until obvious. Comment only WHY.

## Simplicity
- Before adding abstraction: does this solve a problem that exists NOW?
- Inline single-use helpers. Extract only when logic repeats 3+ times or block exceeds ~20 lines.
- Prefer flat function over class when there is no shared state.
- Delete dead code. Never comment it out.

## Maintainability
- Each module has one reason to change. Bug fix touching 3+ files = design problem.
- No shared mutable state across modules. Pass data explicitly.
- Side effects at the edges only (I/O, network, DB). Keep business logic pure.

## Modularity
- No circular imports. If A imports B and B imports A → extract shared code to C.
- Cross-module imports go through `index.ts`. Never import internals of another module directly.
- One file answers one question. Don’t mix unrelated logic just to reduce file count.
- Over-modularizing is also a problem. A 50-line file doing one thing does not need splitting.

## Testability
- Test behavior, not implementation. Call the public API, not internal functions.
- Mock only external I/O (network, DB, clock). Never mock internals.
- Deterministic inputs → deterministic outputs. No hidden state, no global side effects in logic.
- Hard-to-test code = bad design. Fix the design, not the test.

## File Structure
- <50 -> Inline into caller
- 50–400 -> Keep as single file
- More than 400 -> Split by responsibility

Target: **150–300 lines per file.**

## Naming
- Files: `kebab-case`
- `some-feature.ts` → logic
- `some-feature.types.ts` → types only
- `some-feature.test.ts` → tests only
- `index.ts` → re-exports only, zero logic
- Names must be specific enough that search results are unambiguous: `user-auth.ts` > `auth.ts`
- Folders name the domain (`payments/`, `auth/`), not the layer (`utils/`, `helpers/`, `common/`)