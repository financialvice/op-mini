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
 * - tmux for terminal multiplexing
 * - pm2 for process management (via bun)
 */
export const devboxTemplate: MachineTemplate = [
  // Update apt and install base dependencies
  "apt-get update",
  "apt-get install -y ca-certificates gnupg tmux unzip",

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
