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
    && rm -rf /var/lib/apt/lists/*

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

# Create startup script that reads SSH_PUBLIC_KEY env var
RUN printf '%s\n' '#!/bin/bash' \
    'if [ -n "$SSH_PUBLIC_KEY" ]; then' \
    '    echo "$SSH_PUBLIC_KEY" > /root/.ssh/authorized_keys' \
    '    chmod 600 /root/.ssh/authorized_keys' \
    'fi' \
    '/usr/local/bin/wake-service &' \
    'exec /usr/sbin/sshd -D -e' \
    > /usr/local/bin/start.sh \
    && chmod +x /usr/local/bin/start.sh

EXPOSE 2222 42069

CMD ["/usr/local/bin/start.sh"]
