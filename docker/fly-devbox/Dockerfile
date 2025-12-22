FROM debian:bookworm

# Install base dependencies
RUN apt-get update && apt-get install -y \
    ca-certificates \
    curl \
    git \
    gnupg \
    openssh-server \
    tmux \
    unzip \
    wget \
    libfuse2 \
    fuse \
    && rm -rf /var/lib/apt/lists/*

# Install Archil client
RUN curl -fsSL -o /tmp/install-archil.sh https://s3.amazonaws.com/archil-client/install \
    && chmod +x /tmp/install-archil.sh \
    && ARCHIL_SKIP_IAM_CHECK=1 /tmp/install-archil.sh \
    && rm /tmp/install-archil.sh

# Install Node.js 20 LTS
RUN mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
    && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" | tee /etc/apt/sources.list.d/nodesource.list \
    && apt-get update \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Install GitHub CLI
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
    && chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list \
    && apt-get update \
    && apt-get install -y gh \
    && rm -rf /var/lib/apt/lists/*

# Install Bun
ENV BUN_INSTALL=/root/.bun
ENV PATH=$BUN_INSTALL/bin:$PATH
RUN curl -fsSL https://bun.sh/install | bash

# Install global tools via bun
RUN bun install -g pm2 @anthropic-ai/claude-code @openai/codex vercel

# Install uv (Python package manager)
RUN curl -LsSf https://astral.sh/uv/install.sh | sh
ENV PATH=/root/.local/bin:$PATH

# Set hostname and configure PATH for SSH sessions
RUN echo "operator" > /etc/hostname \
    && echo 'export PATH="/root/.bun/bin:/root/.local/bin:$PATH"' > /etc/profile.d/paths.sh

# Configure SSH on port 2222 (Fly uses 22 internally)
RUN mkdir -p /run/sshd /root/.ssh \
    && chmod 700 /root/.ssh \
    && sed -i 's/^#\s*Port.*/Port 2222/' /etc/ssh/sshd_config \
    && sed -i 's/^#\s*PermitRootLogin.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config \
    && sed -i 's/^#\s*PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config \
    && ssh-keygen -A

# Create wake service script (simple HTTP server on 42069 with CORS)
RUN printf '%s\n' '#!/bin/bash' \
    'node -e "require(\"http\").createServer((req,res)=>{res.writeHead(200,{\"Access-Control-Allow-Origin\":\"*\"});res.end(\"ok\")}).listen(42069)"' \
    > /usr/local/bin/wake-service \
    && chmod +x /usr/local/bin/wake-service

# Create Archil mount point (must be empty for FUSE)
RUN mkdir -p /mnt/archil

# Create startup script that reads SSH_PUBLIC_KEY and mounts Archil
RUN printf '%s\n' '#!/bin/bash' \
    'set -e' \
    '' \
    '# Setup SSH authorized_keys' \
    'if [ -n "$SSH_PUBLIC_KEY" ]; then' \
    '    echo "$SSH_PUBLIC_KEY" > /root/.ssh/authorized_keys' \
    '    chmod 600 /root/.ssh/authorized_keys' \
    'fi' \
    '' \
    '# Mount Archil if token is provided' \
    'if [ -n "$ARCHIL_MOUNT_TOKEN" ] && [ -n "$ARCHIL_DISK" ]; then' \
    '    # Use Fly machine ID for unique directory' \
    '    MACHINE_ID="fly-${FLY_MACHINE_ID:-unknown}"' \
    '    echo "Mounting Archil disk: $ARCHIL_DISK (machine: $MACHINE_ID)"' \
    '    archil mount "$ARCHIL_DISK" /mnt/archil --region aws-us-east-1 --shared --no-fork &' \
    '    ARCHIL_PID=$!' \
    '    # Wait for mount to be ready (up to 30 seconds)' \
    '    for i in $(seq 1 30); do' \
    '        if mountpoint -q /mnt/archil 2>/dev/null; then' \
    '            echo "Archil mount ready after ${i}s"' \
    '            break' \
    '        fi' \
    '        sleep 1' \
    '    done' \
    '    if mountpoint -q /mnt/archil 2>/dev/null; then' \
    '        # Create machine-specific directories (mkdir grants ownership in shared mode)' \
    '        # Using /mnt/archil/$MACHINE_ID/ structure (no /machines/ subdir)' \
    '        mkdir -p /mnt/archil/$MACHINE_ID/claude' \
    '        mkdir -p /mnt/archil/$MACHINE_ID/codex' \
    '        # Create symlinks for .claude and .codex' \
    '        ln -sf /mnt/archil/$MACHINE_ID/claude /root/.claude' \
    '        ln -sf /mnt/archil/$MACHINE_ID/codex /root/.codex' \
    '        echo "Archil mounted: /mnt/archil/$MACHINE_ID"' \
    '    else' \
    '        echo "WARNING: Archil mount failed after 30s, continuing without sync"' \
    '        mkdir -p /root/.claude /root/.codex' \
    '    fi' \
    'fi' \
    '' \
    '/usr/local/bin/wake-service &' \
    'exec /usr/sbin/sshd -D -e' \
    > /usr/local/bin/start.sh \
    && chmod +x /usr/local/bin/start.sh

EXPOSE 2222 42069

CMD ["/usr/local/bin/start.sh"]
