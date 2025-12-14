# agents-server
- elysia server (https://elysiajs.com/llms.txt) for starting and continuing cli coding agent sessions
- currently implements Claude Code (claude-agent-sdk) and Codex (codex-sdk)
- under the hood both of these spawn agents that execute in terminal processes in a computer environent (call shell commands, use fs, etc.)
- server can be run locally (in which case it operates in the context of our local machine) or deployed and run on VMs (in which case it operates in the context of the VM)
- unifies concepts across providers (sessions, messages, events, configs, etc.)
- use `populate-models.ts` script to populate `models.ts` with up-to date model information
- exports helpers to make it easy to build simple, type-safe apps on top
- keep it simple
- keep strong mapping to native provider concepts (don't lose important features / support when unifying)
- always reference docs / source code


# docs / source code
- Claude Code (claude-agent-sdk); closed source, but good docs: @packages/claude-agents-sdk-docs/docs ; confusingly named but is the core of claude-code
- Codex (codex-sdk); open source, bad docs: @packages/codex-sdk-docs/docs ; prefer to reference the source code by cloning https://github.com/openai/codex into tmp dir, explore the ts (thin sdk) and rust (majority of codebase, extensive) code to deeply understand mechanics and context, explore tests to see expected bevahior in action