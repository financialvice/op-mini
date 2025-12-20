---
name: machine-setup
description: Configure and manage MorphCloud microVMs. Use when the user asks about microVMs, cloud instances, or mentions Morph/morph.so. Covers instance lifecycle (start/stop/pause/resume), snapshots, SSH access, file transfers, and HTTP exposure.
---

# Machine Setup

Manage MorphCloud microVMs using the `morphcloud` CLI.

## Quick Start

Run the setup script to ensure the CLI is installed and get a full command map:

```bash
bash scripts/ensure-morphcloud.sh
```

**Important**: This script is bundled with this skill. Resolve the path relative to this skill's directory before executing (e.g., if this skill is at `.claude/skills/machine-setup/`, run `bash .claude/skills/machine-setup/scripts/ensure-morphcloud.sh`).

## Environment

Set `MORPH_API_KEY` before running commands:

```bash
export MORPH_API_KEY="morph_xxx"
```

## CLI Reference

### Core Concepts

- **Image**: Base OS image (Ubuntu, etc.)
- **Snapshot**: Saved VM state (image + config + disk state)
- **Instance**: Running VM from a snapshot

### Common Workflows

**Create a new VM:**

```bash
# List available images
morphcloud image list

# Create snapshot from image
morphcloud snapshot create --image-id <image_id> --vcpus 2 --memory 4096 --disk-size 10240

# Start instance from snapshot
morphcloud instance start <snapshot_id>
```

**Connect to instance:**

```bash
# Interactive SSH
morphcloud instance ssh <instance_id>

# Run command
morphcloud instance exec <instance_id> -- ls -la

# Copy files
morphcloud instance copy ./local.txt <instance_id>:/remote/path/
morphcloud instance copy <instance_id>:/remote/file.log ./local/
```

**Expose HTTP service:**

```bash
morphcloud instance expose-http <instance_id> myservice 8080
```

**Instance lifecycle:**

```bash
morphcloud instance pause <instance_id>   # Preserve state
morphcloud instance resume <instance_id>  # Resume paused
morphcloud instance stop <instance_id>    # Terminate
```

**Save state:**

```bash
morphcloud instance snapshot <instance_id>
```

### Command Groups

| Group | Purpose |
|-------|---------|
| `instance` | Manage running VMs (start, stop, ssh, exec, copy) |
| `snapshot` | Manage saved VM states |
| `image` | List base images |
| `user` | Manage API keys and SSH keys |
