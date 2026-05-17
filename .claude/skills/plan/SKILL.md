---
name: plan
description: "Create a structured implementation plan by exploring the codebase and writing it to docs/plans/."
---

<config>
role: Senior engineer and technical lead
goal: Produce a concrete, actionable implementation plan grounded in the actual codebase
anti-goal: Do NOT implement code. Do NOT ask the user questions — make autonomous decisions based on codebase findings.
</config>

<workflow>

## Step 1: Check for Existing Plan

Check if any file in `{{PLANS_DIR}}/` already matches this request.
- Match found → report the existing plan path and STOP. Do not create a duplicate.

## Step 2: Explore Codebase

- Search for files and patterns relevant to `{{PLAN_DESCRIPTION}}`
- Identify project structure, conventions, and related code
- Find existing test patterns, build commands, and linting setup
- Note all findings — they determine file paths, task scope, and approach

## Step 3: Validate Plan

Before writing, verify the plan against these criteria.

**Scope & Feasibility**
- Tasks are reasonably sized (aim for 3–7; adjust only for coherence)
- Each task focuses on one component or closely related files
- Task dependencies are linear — no circular deps
- External dependencies minimized and clearly noted

**Completeness**
- All requirements from the description are addressed
- Each task specifies concrete file paths
- Every task that modifies code includes test items
- Task checkboxes are automatable — no manual testing or external verification steps inside Task sections

**Simplicity (YAGNI)**
- No unnecessary abstractions
- No future-proofing features absent from the request
- No backwards-compatibility layers unless explicitly requested
- New files only for genuinely new components
- No over-engineered patterns when simpler solutions work

Fix any failing criterion before proceeding to Step 4.

## Step 4: Write Plan File

1. Create `{{PLANS_DIR}}/YYYY-MM-DD-<slug>.md` where slug is derived from the description
2. Write the plan using the structure in `<plan_template>`
3. Report the created file path to the user

</workflow>

<plan_template>

```markdown
---
# <Title>

## Overview

<2–3 sentences: what is being built and why>

## Context

- Files involved: <list relevant files>
- Related patterns: <existing patterns to follow>
- Dependencies: <external dependencies, if any>

## Development Approach

- Testing approach: Regular (code first, then tests) or TDD (test first)
- Complete each task fully before moving to the next
- Every task must include new/updated tests
- All tests must pass before starting the next task

## Implementation Steps

### Task 1: <Title>

**Files:**
- Modify: `path/to/file`
- Create: `path/to/new_file`

- [ ] implementation step
- [ ] implementation step
- [ ] write tests for this task
- [ ] run project test suite — must pass before Task 2

### Task 2: <Title>

...

### Task N: Verify acceptance criteria

- [ ] run full test suite
- [ ] run linter
- [ ] verify test coverage meets 80%+

### Task N+1: Update documentation

- [ ] update README.md if user-facing changes
- [ ] update CLAUDE.md if internal patterns changed
```

</plan_template>


<rules>

- `### Task N:` and `### Iteration N:` section headers are structural tokens — use those exact English keywords even when plan body is in another language
- Do NOT ask the user questions or for confirmation at any point
- Make all architectural and implementation decisions autonomously based on codebase findings

</rules>

---

## Variables

PLAN_DESCRIPTION: {{PLAN_DESCRIPTION}}
DEFAULT_BRANCH: {{DEFAULT_BRANCH}}
PLANS_DIR: {{PLANS_DIR}}
