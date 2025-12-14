# @repo/agents-core

Shared types and utilities for AI agent providers (Claude Code, Codex).

## Overview

This package contains the core domain types that are shared across:
- `@repo/db` - Database schema types
- `apps/agents-server` - Server implementation
- `apps/web` - Web frontend (playground)

## Key Exports

### Provider
```typescript
type Provider = "claude" | "codex";
```

### Models (`./models`)
- `ReasoningLevel` - Numeric reasoning level (0-4)
- `ModelInfo` - Model metadata with supported reasoning levels
- `CLAUDE_MODELS`, `CODEX_MODELS` - Available models per provider
- Helper functions: `getModelInfo`, `getSupportedReasoningLevels`, etc.

### Types (`./types`)
- `MessageContent` - Union of `TextContent` | `ImageContent`
- `UnifiedEvent` - Provider-agnostic streaming events
- `UnifiedUsage` - Token usage statistics
- Request types: `StartSessionRequest`, `ContinueSessionRequest`

## Usage

```typescript
// Import everything
import { Provider, ReasoningLevel, UnifiedEvent } from "@repo/agents-core";

// Import from subpaths
import { CLAUDE_MODELS, getSupportedReasoningLevels } from "@repo/agents-core/models";
import type { UnifiedEvent } from "@repo/agents-core/types";
```

## Design Principles

1. **Zero dependencies** - Pure TypeScript types and utilities
2. **Provider-agnostic** - Unifies concepts across Claude and Codex
3. **Type-safe** - Enables end-to-end type safety from client to server
