---
name: operator-project-setup
description: Use this skill when creating a new project on the Operator platform.
---

# Operator Machine Setup

You are currently singularly focused on collaborating with the user to create and configure a new project.

## Communicating with the user

IMPORTANT: The current user is a user of the Operator platform, and not directly interacting with Claude. You are acting as an agent on their behalf.

There are only two ways to communicate with the user:
1. Use the AskUserQuestion tool to ask questions, clarify and gather information as needed.
2. Output text to communicate with the user; all text you output outside of tool use is displayed to the user.

## Creating Templates with operator-cli

The `operator templates create` command handles all template creation. It chains MorphCloud snapshots automatically, with caching for efficiency.

### Usage

```bash
# Extend the devbox template (default) - adds commands on top of base devbox
operator templates create --name "my-template" "apt install -y vim" "npm install -g typescript"

# Create from scratch (includes full devbox setup first)
operator templates create --type custom --name "my-template" "apt install -y vim"

# Pipe commands as JSON array
echo '["apt install -y vim", "npm install -g typescript"]' | operator templates create --name "my-template"

# List available templates
operator templates list
```

### Options

- `--type append` (default): Start from the existing devbox template and add your commands
- `--type custom`: Start from scratch (morphvm-minimal) - includes the full devbox setup automatically
- `--name <name>`: Template name (recommended for identification)

### What's in the devbox template

The base devbox template includes:
- Node.js LTS (v20.x), Bun, npm
- GitHub CLI (gh), Vercel CLI
- Claude Code, OpenAI Codex CLI
- tmux, pm2 (process manager)
- uv (Python), morphcloud CLI
- agents-server on port 42070
- Wake service on port 42069

### On failure

If a command fails, the CLI will:
1. Show which step failed and the error
2. Provide the last successful snapshot ID for debugging

To debug, use `morphcloud instance exec` to inspect the state:
```bash
morphcloud instance start <last-snapshot-id>
morphcloud instance exec <instance-id> "cat /var/log/apt/history.log"
```

IMPORTANT: Only use `morphcloud instance exec` for INSPECTING failures. Do not manually execute setup commands one by one - always use `operator templates create`.

## Starting an Instance from a Template

After creating a template, start an instance:

```bash
# List templates to find the snapshot ID
operator templates list

# Start instance from template
morphcloud instance start <snapshot-id>
```

## Common Setups

### Fullstack Project with shadcn/ui

One very common configuration is a machine with a template fullstack project:

```bash
operator templates create --name "fullstack-nextjs" \
  'bunx --bun shadcn@latest create --preset "https://ui.shadcn.com/init?base=radix&style=vega&baseColor=neutral&theme=neutral&iconLibrary=lucide&font=inter&menuAccent=subtle&menuColor=default&radius=default&template=next" --template next -y my-app' \
  'cd my-app && bunx --bun shadcn@latest add --all'
```

Available options:
- base: "radix" (Radix UI; mature, accessible), "base" (Base UI; newer unstyled primitives; https://base-ui.com/llms.txt)
- style: "vega" (classic shadcn/ui; clean, neutral), "nova" (compact; reduced padding/margins), "maia" (soft, rounded; generous spacing), "lyra" (boxy, sharp; pairs with mono fonts), "mira" (compact; dense interfaces)
- baseColor: "neutral", "stone", "zinc", "gray"
- theme: "neutral", "stone", "zinc", "gray", "amber", "blue", "cyan", "emerald", "fuchsia", "green", "indigo", "lime", "orange", "pink", "purple", "red", "rose", "sky", "teal", "violet", "yellow"
- iconLibrary: "lucide", "tabler", "hugeicons", "phosphor"
- font: "geist-sans", "inter", "noto-sans", "nunito-sans", "figtree", "roboto", "raleway", "dm-sans", "public-sans", "outfit", "jetbrains-mono"
- menuAccent: "subtle", "bold"
- menuColor: "default", "inverted"
- radius: "default", "none" (0), "small" (0.45rem), "medium" (0.625rem), "large" (0.875rem)
- template: "next" (Next.js), "start" (TanStack Start), "vite" (Vite + React)

If the user wants a fullstack project, use shadcn create with varied options that match their request's tone and requirements.

## Workflow

1. If the user's request is vague, ask clarifying questions using AskUserQuestion.
2. Determine the setup commands needed for the user's request.
3. Run `operator templates create` with the appropriate commands and name.
4. Start an instance from the new template snapshot.
5. Configure any additional settings (network ports, pm2 services, etc.).
6. Pause the instance and set metadata `pinned: true` to make it available to the user.

IMPORTANT: Set `pinned: true` metadata before your final response to the user.
