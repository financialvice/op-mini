# Project Context

## op-mini
- minimal, most simple, low LOC demo implementation of Operator, a platform for using coding agents like Claude Code, Codex, etc.
- always choose simplest solution

## Operator Stack
Use the Operator Stack.
- NextJS 16
- Expo SDK 54
- InstantDB
- Trigger.dev v4
- tRPC v11 + TanStack Query
- shadcn (web) and heroui-native (mobile)
- Tailwind v4 (no config file)

### InstantDB
Client-side database (Modern Firebase) with built-in queries, transactions, auth, permissions, storage, real-time, and offline support. Most db queries and transactions should happen client-side. This is a paradigm shift from traditional patterns. With InstantDB, useQuery is live and will automatically sync / update on any transaction (local and remote). Most queries will load in 0ms and transactions will execute in 0ms. Everything is instant.

See docs map if needed: https://www.instantdb.com/llms.txt

### Trigger.dev
Platform for building workflows in TypeScript. Long-running tasks with retries, queues, observability, and elastic scaling. Use Trigger.dev for cases where we need automatic retries (critical business logic), multi-step workflows (AI workflows), and crons or scheduled jobs.

See docs map if needed: https://trigger.dev/docs/llms.txt

### tRPC + TanStack Query
Make sure to use the new TanStack React Query integration (see docs/trpc-tanstack-react-query.md if implementing a new tRPC query or mutation on the frontend).

See docs map if needed: https://trpc.io/llms.txt

## Expected Workflow
Our linting is very strict. Use bun run lint:fix to automatically fix a majority of lint issues. Use bun run typecheck to validate changes. CRITICAL: Always ensure lint and typecheck pass before stopping

## Project Structure

### Monorepo Structure
camono/
├── apps/
│   ├── mobile/              # Expo React Native mobile application
│   ├── task-runner/         # Trigger.dev dev server
│   └── web/                 # Next.js
└── packages/
    ├── db/                  # Database (InstantDB) layer
    ├── tasks/               # Trigger.dev task definitions
    ├── trpc/                # tRPC API layer
    ├── typescript-config/   # Shared TS configs
    ├── ui/                  # Shared UI components
    └── vitest-config/       # Test configuration

Packages are typically consumed as TypeScript source directly - we do NOT build packages unless absolutely required (rate)

## Package Management
- Use bun / bunx
- Use Bun Workspaces
- Use Bun Catalogs. Root package.json defines shared dep versions, apps/packages use catalog: to reference

## Resources
If you are stuck with any of the above services, see docs/resources.md for links to additional docs.

---

# Linting and Typechecking

This project uses **Ultracite**, a zero-config Biome preset that enforces strict code quality standards through automated formatting and linting.

## Quick Reference

Biome (the underlying engine) provides extremely fast Rust-based linting and formatting. Most issues are automatically fixable.

---

## Core Principles

Write code that is **accessible, performant, type-safe, and maintainable**. Focus on clarity and explicit intent over brevity.

### Type Safety & Explicitness

- Use explicit types for function parameters and return values when they enhance clarity
- Prefer `unknown` over `any` when the type is genuinely unknown
- Leverage TypeScript's type narrowing instead of type assertions

### Modern JavaScript/TypeScript

- Use arrow functions for callbacks and short functions
- Prefer `for...of` loops over `.forEach()` and indexed `for` loops
- Use optional chaining (`?.`) and nullish coalescing (`??`) for safer property access
- Prefer template literals over string concatenation
- Use destructuring for object and array assignments
- Use `const` by default, `let` only when reassignment is needed, never `var`

### Async & Promises

- Always `await` promises in async functions - don't forget to use the return value
- Use `async/await` syntax instead of promise chains for better readability
- Handle errors appropriately in async code with try-catch blocks
- Don't use async functions as Promise executors

### Code Organization

- Keep functions focused and under reasonable cognitive complexity limits
- Extract complex conditions into well-named boolean variables
- Use early returns to reduce nesting
- Prefer simple conditionals over nested ternary operators
- Group related code together and separate concerns

### Framework-Specific Guidance

**Next.js:**
- Use Next.js `<Image>` component for images
- Use `next/head` or App Router metadata API for head elements

**React 19+:**
- Use ref as a prop instead of `React.forwardRef`

---

## Testing

- Write assertions inside `it()` or `test()` blocks
- Avoid done callbacks in async tests - use async/await instead
- Don't use `.only` or `.skip` in committed code
- Keep test suites reasonably flat - avoid excessive `describe` nesting

## When Biome Can't Help

Biome's linter will catch most issues automatically. Focus your attention on:

1. **Business logic correctness** - Biome can't validate your algorithms
2. **Meaningful naming** - Use descriptive names for functions, variables, and types
3. **Architecture decisions** - Component structure, data flow, and API design
4. **Edge cases** - Handle boundary conditions and error states
5. **User experience** - Accessibility, performance, and usability considerations
6. **Documentation** - Add comments for complex logic, but prefer self-documenting code
