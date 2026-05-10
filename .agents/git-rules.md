# Git rules

## Branches

- `master` - the main branch
- `{change-type}/{semantic-name}` - feature branches, where `change-type` is one of `feat`, `fix`, `refactor`, etc. and `semantic-name` describes the change (e.g., `feat/add-login`).

**Never** commit directly to `master`. Always create a feature branch and open a pull request for review.

## Pull Requests

Format: `{Change Type}: {Short Description}` (e.g., `feat: add login endpoint`).

## Change types

| Type | Purpose |
|---|---|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation only |
| `style` | Formatting/style (no logic) |
| `refactor` | Code refactor |
| `perf` | Performance improvement |
| `test` | Add/update tests |
| `build` | Build system/dependencies |
| `ci` | CI/config changes |
| `chore` | Maintenance/misc |