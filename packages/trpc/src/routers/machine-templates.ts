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
 * - tmux for terminal multiplexing
 * - pm2 for process management (via bun)
 */
export const devboxTemplate: MachineTemplate = [
  // Update apt and install base dependencies
  "apt-get update",
  "apt-get install -y ca-certificates gnupg tmux",

  // Install Node.js LTS (v20.x) via NodeSource
  "mkdir -p /etc/apt/keyrings",
  "curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg",
  'echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" | tee /etc/apt/sources.list.d/nodesource.list',
  "apt-get update",
  "apt-get install -y nodejs",

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

  // Install AI coding assistants globally via bun
  "$HOME/.bun/bin/bun install -g @anthropic-ai/claude-code @openai/codex",

  // Clean up apt cache to save disk space
  "apt-get clean",
  "rm -rf /var/lib/apt/lists/*",
];
