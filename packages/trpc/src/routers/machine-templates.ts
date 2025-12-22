/**
 * Machine Templates for MorphCloud VMs
 *
 * Base Image: morphvm-minimal (Debian 12 bookworm)
 * Pre-installed: git, curl, wget, ssh, bash, apt (~207 packages, 251MB)
 */

type MachineTemplate = string[];

/**
 * Devbox Template - Standard development environment
 *
 * Installs:
 * - Node.js LTS (v20.x) via NodeSource
 * - Bun (latest) via official installer
 * - GitHub CLI (gh) for repository operations
 * - Vercel CLI for deployments
 * - Claude Code and Codex CLI
 * - tmux for terminal multiplexing
 * - pm2 for process management (via bun)
 * - uv and morphcloud CLI
 * - Archil client for shared filesystem
 */
export const devboxTemplate: MachineTemplate = [
  // Set hostname for consistent prompt across providers
  "hostnamectl set-hostname operator",

  // Update apt and install base dependencies (including libfuse2 for Archil)
  "apt-get update",
  "apt-get install -y ca-certificates gnupg tmux unzip libfuse2 fuse",

  // Install Archil client
  "curl -fsSL -o /tmp/install-archil.sh https://s3.amazonaws.com/archil-client/install",
  "chmod +x /tmp/install-archil.sh",
  "ARCHIL_SKIP_IAM_CHECK=1 /tmp/install-archil.sh",
  "rm /tmp/install-archil.sh",
  "mkdir -p /mnt/archil",

  // Create Archil mount helper script (called after instance boot with machine ID)
  // Usage: ARCHIL_MOUNT_TOKEN=xxx ARCHIL_DISK=yyy /usr/local/bin/mount-archil.sh <machine-id>
  // Structure: /mnt/archil/<machine-id>/claude, /mnt/archil/<machine-id>/codex
  // Each machine owns only its directory, avoiding conflicts over shared parent dirs
  `cat > /usr/local/bin/mount-archil.sh << 'SCRIPT'
#!/bin/bash
set -e
MACHINE_ID=$1
if [ -z "$MACHINE_ID" ] || [ -z "$ARCHIL_MOUNT_TOKEN" ] || [ -z "$ARCHIL_DISK" ]; then
  echo "Usage: ARCHIL_MOUNT_TOKEN=xxx ARCHIL_DISK=yyy mount-archil.sh <machine-id>"
  exit 1
fi
echo "Mounting Archil disk: $ARCHIL_DISK (machine: $MACHINE_ID)"
archil mount "$ARCHIL_DISK" /mnt/archil --region aws-us-east-1 --shared --no-fork &
for i in $(seq 1 30); do
  if mountpoint -q /mnt/archil 2>/dev/null; then
    echo "Archil mount ready after \${i}s"
    break
  fi
  sleep 1
done
if ! mountpoint -q /mnt/archil 2>/dev/null; then
  echo "ERROR: Archil mount failed after 30s"
  exit 1
fi

# Create machine-specific directory (mkdir in unowned parent grants ownership)
# If parent is owned by another client, force checkout to take ownership briefly
MACHINE_DIR="/mnt/archil/$MACHINE_ID"
if ! mkdir -p "$MACHINE_DIR" 2>/dev/null; then
  echo "Parent owned by another client, forcing checkout..."
  echo "y" | archil checkout "$MACHINE_DIR" --force 2>/dev/null || true
  mkdir -p "$MACHINE_DIR"
fi

# Create subdirs for claude and codex
mkdir -p "$MACHINE_DIR/claude" "$MACHINE_DIR/codex"

# Create symlinks
rm -f /root/.claude /root/.codex
ln -sf "$MACHINE_DIR/claude" /root/.claude
ln -sf "$MACHINE_DIR/codex" /root/.codex

echo "Archil mounted: $MACHINE_DIR"
archil delegations /mnt/archil 2>/dev/null || true
SCRIPT`,
  "chmod +x /usr/local/bin/mount-archil.sh",

  // Install GitHub CLI (gh)
  "curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg",
  "chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg",
  'echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list',

  // Install Node.js LTS (v20.x) via NodeSource
  "mkdir -p /etc/apt/keyrings",
  "curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg",
  'echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" | tee /etc/apt/sources.list.d/nodesource.list',
  "apt-get update",
  "apt-get install -y nodejs gh",

  // Install Bun and configure PATH for all shell types
  "curl -fsSL https://bun.sh/install | bash",
  `cat >> ~/.profile << 'EOF'
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"
EOF`,
  `cat >> ~/.bashrc << 'EOF'
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"
EOF`,

  // Install pm2 globally via bun (using absolute path since PATH isn't set in this session)
  "$HOME/.bun/bin/bun install -g pm2",

  // Install AI coding assistants and deployment tools globally via bun
  "$HOME/.bun/bin/bun install -g @anthropic-ai/claude-code @openai/codex vercel",

  // Install uv (fast Python package installer) and morphcloud CLI
  "curl -LsSf https://astral.sh/uv/install.sh | sh",
  `cat >> ~/.profile << 'EOF'
export PATH="$HOME/.local/bin:$PATH"
EOF`,
  `cat >> ~/.bashrc << 'EOF'
export PATH="$HOME/.local/bin:$PATH"
EOF`,
  "$HOME/.local/bin/uv tool install morphcloud",

  // Start wake service on port 42069 for HTTP wake-on-lan (with CORS headers)
  `$HOME/.bun/bin/pm2 start --name wake "node -e \\"require('http').createServer((req,res)=>{res.writeHead(200,{'Access-Control-Allow-Origin':'*'});res.end('ok')}).listen(42069)\\""`,
  "$HOME/.bun/bin/pm2 save",

  // Clean up apt cache to save disk space
  "apt-get clean",
  "rm -rf /var/lib/apt/lists/*",
];
