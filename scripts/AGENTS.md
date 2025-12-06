# scripts - Monorepo Utility Scripts

This workspace contains utility scripts for managing and maintaining the monorepo. These are internal tools that help with development workflows, database initialization, and code quality maintenance.

## Purpose

The scripts workspace provides command-line utilities that operate on the entire monorepo. Unlike application code in `apps/` or shared libraries in `packages/`, these scripts are development tooling that help maintain consistency and automate common tasks across the repository.

## Available Scripts

### db-init.ts
Initializes a new InstantDB application and configures all workspace packages with the necessary environment variables.

**Usage**: `bun run db:init [app-title]`

**What it does**:
- Creates a new InstantDB app using `instant-cli`
- Updates `.env` files across all apps and packages with the new app ID and admin token
- Pushes the database schema and permissions from `packages/db`
- Handles both client-side (EXPO_PUBLIC_, NEXT_PUBLIC_) and server-side environment variables

### sort-pkg.ts
Sorts all `package.json` files in the monorepo according to a standardized field order.

**Usage**:
- `bun run sort-pkg` - Sort all package.json files
- `bun run sort-pkg:check` - Check if files need sorting (exits with code 1 if unsorted)

**What it does**:
- Scans for all package.json files in root, apps/*, and packages/*
- Sorts fields according to customOrder (scripts come after name/version/private)
- Reports which files were sorted or already sorted

## Workspace Structure

```
scripts/
├── src/
│   ├── db-init.ts       # InstantDB initialization script
│   └── sort-pkg.ts      # package.json sorting utility
├── package.json         # Workspace dependencies
├── tsconfig.json        # TypeScript config (extends @repo/typescript-config)
└── CLAUDE.md            # This file
```

## Dependencies

- **@repo/typescript-config**: Shared TypeScript configuration
- **sort-package-json**: Package.json sorting library
- **@types/bun**: Type definitions for Bun runtime
- **@types/node**: Type definitions for Node.js APIs

## Workspace Integration

This workspace is configured as part of the Bun workspace in the root `package.json`:

```json
{
  "workspaces": {
    "packages": ["apps/*", "packages/*", "scripts"]
  }
}
```

Benefits of being a workspace:
- Can import from other `@repo/` packages using `workspace:` protocol
- Included in Turborepo pipelines for linting and typechecking
- Shares dependency versions via Bun catalogs
- Managed by monorepo tooling (Turbo, Biome, etc.)

## Running Scripts

Scripts are executed from the monorepo root using the defined npm scripts:

```bash
bun run db:init              # Initialize new InstantDB app
bun run sort-pkg             # Sort all package.json files
bun run sort-pkg:check       # Check if package.json files need sorting
```

Scripts can also be run directly:

```bash
bun run scripts/src/db-init.ts
bun run scripts/src/sort-pkg.ts --check
```

## Development

### Adding a New Script

1. Create a new `.ts` file in `scripts/src/`
2. Add shebang: `#!/usr/bin/env bun`
3. Add corresponding command to root `package.json` scripts
4. Document the script in this file
5. Ensure it passes linting and typechecking

### Linting and Typechecking

The scripts workspace is included in the Turborepo pipeline:

```bash
bun run lint --filter=@repo/scripts
bun run typecheck --filter=@repo/scripts
bun run lint:fix --filter=@repo/scripts
```

### Code Quality

Scripts must adhere to Biome/Ultracite linting rules, including:
- Maximum cognitive complexity of 15 per function
- Proper import organization
- Consistent formatting (2-space indentation)
- No excessive nesting or complexity

## Common Patterns

### File Path Resolution
Always use `process.cwd()` to get the repo root, since scripts are run from the monorepo root:

```typescript
const REPO_ROOT = process.cwd();
const filePath = join(REPO_ROOT, "apps/web/.env");
```

### Error Handling
Wrap main logic in try/catch and exit with code 1 on error:

```typescript
async function main() {
  // script logic
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
```

### Shell Commands
Use Bun's `$` template literal for shell commands:

```typescript
import { $ } from "bun";
await $`bunx instant-cli push all -a ${appId} -y`;
```

## Notes

- Scripts are compiled and type-checked but not built to dist/
- They run directly as TypeScript using Bun's native TS support
- Keep scripts focused and single-purpose
- Extract complex logic into helper functions to maintain low cognitive complexity
