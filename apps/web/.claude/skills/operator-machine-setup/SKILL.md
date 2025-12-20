---
name: operator-machine-setup
description: Use this skill when configuring a machine as part of Operator's machine setup flow.
---

# Operator Machine Setup

You are currently singularly focused on collaborating with the user to configure a new microVM.

## Communicating with the user

IMPORTANT: The current user is a user of the Operator platform, and not directly interacting with Claude. You are acting as an agent on their behalf. 

There are only three ways to communicate with the user:
1. Use the AskUserQuestion tool to ask questions, clarify and gather information as needed.
2. Use the `morphcloud instance set-metadata` command to set the machine's metadata. Machine metadata and exposed network services will be displayed to the user.
3. Output text to communicate with the user; all text you output outside of tool use is displayed to the user.

## Operator Platform Default Snapshot

The default configuration for a new machine is 1vcpu, 4GB RAM, 16GB disk.

To be more efficient and consistent when creating new machines, the Operator platform has pre-created a snapshot with metadata `type: "OPERATOR_PLATFORM_DEFAULT_IMAGE"`. ALWAYS check for this snapshot, and begin the setup process by starting an instance from this snapshot. If this snapshot does not exist, you should create a new snapshot from the "morphvm-minimal" image and then seed it with sensible, simple defaults like:
- hostnamectl set-hostname operator
- curl, ca-certificates, gnupg (MUST install these FIRST - the base image is very minimal)
- node (ensure latest LTS, >=20.9.0 required for Next.js)
- bun
- tmux
- pm2
- uv
- morphcloud (via uv tool)
- gh
- vercel
- curl -fsSL https://claude.ai/install.sh | bash (Claude Code native install)
- bun i -g @openai/codex
- unzip
- wake service on port 42069 (simple HTTP server responding "ok" with CORS headers)
- any other required, base-level dependencies for a simple devbox
- ensure that everything is available on all paths for all users

IMPORTANT: The morphvm-minimal base image does NOT have curl installed. You MUST install curl and ca-certificates via apt BEFORE running any `curl | bash` installation scripts.

IMPORTANT: After installing tools, VALIDATE each installation by checking its version. Node.js is particularly critical - if `node --version` shows v18.x instead of v20+, the installation failed (likely because curl wasn't available when fetching the setup script). Node.js >=20.9.0 is required for Next.js.

Also, make sure to set up:
- wake on http
- wake on ssh
- expose http 42069 wake service
- set reasonable TTL like 300 seconds

IMPORTANT: If the Operator Platform Default snapshot does not exist, NEVER create it by starting from an existing instance. If you must create a new default snapshot, start by creating a new snapshot from the "morphvm-minimal" image.

Make sure to add the `type: "OPERATOR_PLATFORM_DEFAULT_IMAGE"` metadata to the snapshot, so that future setup processes can easily discover and use this snapshot.

Once an Operator Platform Default snapshot is verified (or created if does not exist), you can begin customizing the machine for the user's specific needs.

## Common setups

One very common initial configuration is a machine with a template fullstack project. Shadcn/ui is an excellent source for this, and there's a newly-added "create" command with presets.

The default command is `bunx --bun shadcn@latest create --preset "https://ui.shadcn.com/init?base=radix&style=vega&baseColor=neutral&theme=neutral&iconLibrary=lucide&font=inter&menuAccent=subtle&menuColor=default&radius=default&template=next" --template next -y <project-name>`.

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

If the user signals in any way that they might be working on something that would benefit from a fullstack project, you should always proactively create a fullstack project on the machine. In regards to safe defaults, using NextJS should be the default. For all other parameters, it is good to vary the options to keep things interesting. Use your contextual awareness and infer option values that would pleasantly surprise the user and match the tone, requirements, and sensibilities of their request.

IMPORTANT: If seeding with a fullstack project, always use the shadcn create command with a preset (unless the user explicitly requests otherwise), and choose options that fit the request.

The create command will adds ~10 of 50+ available components. After create, ALWAYS (unless the user explicitly requests otherwise) install ALL shadcn/ui components with `bunx --bun shadcn@latest add --all`. This will install all components.

In addition to creating a project, it is best practice to ensure that a git repo is initialized and pushed via the gh cli.

If you create any apps, servers, etc. that should be easily accessible for the user, you should always:
- Start any tasks (dev servers, background tasks, etc.) via pm2.
- Expose their network ports via morphcloud.

## Workflow
1. If the user's request is vague or not specific, ask clarifying questions using the AskUserQuestion tool.
2. Once the objective for machine setup is clear enough to begin, find the Operator Platform Default snapshot.
3. Start a new instance from the Operator Platform Default snapshot.
4. Configure the new instance based on the user's request and context.
5. Validate installations before starting any dev servers or apps (especially confirm `node --version` shows >=20.9.0). Also, validate tasks after starting.
6. Once the new instance is configured, pause the new instance.
7. Set the new instance's metadata to include: `pinned: true`. This will pin the new instance and make it available for the user to use in the Operator platform. IMPORTANT: You must set this metadata property before your final response to the user.
