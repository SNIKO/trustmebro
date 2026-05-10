# TypeScript Coding Rules

Role: TypeScript engineer writing readable, consistent production code.
Goal: Code that is easy to scan, change, and delete.
Anti-goal: No ceremony, no premature abstraction, no comments where none are needed.

Apply when writing or modifying TypeScript code.

---

## File Order: Story First, Details Below

Every file follows this order:
1. Imports
2. Types and interfaces
3. Main exported function(s) — the entry point
4. Supporting functions — in call order
5. Pure utilities

Reader sees *what* the file does before *how*.

---

## Functions

- One function = one idea. Sections needing comments to separate them → extract.
- 10–20 lines per function. Over 20: split.
- Named `function` declarations for async or multi-statement logic — appear in stack traces, easier to scan.
- Arrow functions for short predicates and transforms.
- No abstractions before 3+ real uses.

```typescript
// Named — multi-line, async, complex
async function processOrder(id: string): Promise<void> { ... }

// Arrow — short predicate or transform
const isActive = (user: User) => user.active
```

---

## Naming

- Functions → verbs: `fetchOrder`, `validateUser`, `buildPayload`
- Variables → nouns: `userId`, `pendingOrders`
- Booleans → questions or adjectives: `isLoading`, `hasError`, `canSubmit`
- Types → PascalCase nouns: `OrderSummary`, `ApiResponse<T>` — never `IUser`, `TUser`
- No: `data`, `item`, `result`, `temp`, `handle`, `process`
- Rename instead of commenting.

---

## Early Returns

Guards at the top. Happy path last — unindented, clearly the main job.

```typescript
function process(user?: User) {
  if (!user) return
  if (!user.isActive) return
  return sendEmail(user)
}
```

---

## Vertical Spacing

Blank line = new logical step. Use intentionally.
- One blank line between items in same group
- Two blank lines between top-level functions
- No blank lines inside short functions (< 10 lines)

---

## Conditionals

- Ternary only for trivial two-branch cases.
- 2+ conditions → `if/else`.
- Many branches → lookup table.

```typescript
const STATUS_LABELS: Record<Status, string> = {
  active: 'Active',
  pending: 'Pending',
  closed: 'Closed',
}
const label = STATUS_LABELS[status] ?? 'Unknown'
```

---

## Array Chains

≤2 chained methods: inline. 3+: extract to named steps.

```typescript
// BAD
const result = users.filter(u => u.active).map(u => u.profile).filter(p => p !== null).map(p => p!.email)

// GOOD
const activeUsers = users.filter(isActive)
const profiles = activeUsers.map(getProfile)
const emails = profiles.filter(isDefined).map(getEmail)
```

---

## Types

- Extract inline types — name them once, reuse.
- Union types over magic strings: `type Status = 'idle' | 'loading' | 'success' | 'error'`
- No `any` — use `unknown` + type guard.
- No `as` assertions — fix the type instead.
- No generics without a real reason (preserving a type relationship).

---

## Async

`async/await` throughout. No `.then()`.

---

## Syntax

**Use:**
- Destructuring (shallow only)
- Optional chaining + nullish coalescing: `user?.address?.city ?? 'Unknown'`
- Default parameters
- `??` not `||` when `0` or `''` are valid values

**Avoid:**
- Deep destructuring: `const { a: { b: { c }}} = obj`
- `||` where `??` is correct
- Boolean gymnastics: `!!user && !(!user.active || user.deleted)`
- Nested ternaries

---

## Statement Order: Light Before Heavy

Order statements by weight — short/simple first, long/complex last.

**Declarations:** shorter lines first.
```typescript
// GOOD — eye lands on short lines, builds up
const user       = file.readUser()
const company    = file.readCompany()
const department = file.readDepartment()

// BAD — long line disrupts reading rhythm
const department = file.readDepartment()
const user       = file.readUser()
const company    = file.readCompany()
```

**Imports:** built-ins → third-party → internal. Within each group, shorter paths first.
```typescript
import fs from 'fs'
import path from 'path'

import { z } from 'zod'
import express from 'express'

import { config } from './config'
import { processOrder } from './orders/process-order'
```

**Object properties:** short/primitive values first, complex/nested last.
```typescript
// GOOD
const config = {
  port: 3000,
  host: 'localhost',
  timeout: 5000,
  middleware: [authMiddleware, loggingMiddleware],
  database: { host: dbHost, port: dbPort, name: dbName },
}
```

**Function arguments:** constants and literals before computed values before callbacks.
```typescript
// GOOD
createUser(id, name, isActive, getUserPermissions(role))

// BAD
createUser(getUserPermissions(role), id, name, isActive)
```

**Conditions in boolean expressions:** cheap checks before expensive ones (short-circuits early).
```typescript
// GOOD — isActive is a field lookup; isEligible() is a function call
if (user.isActive && isEligible(user)) { ... }
```
