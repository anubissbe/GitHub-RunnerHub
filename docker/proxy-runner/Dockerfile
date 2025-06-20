FROM ubuntu:22.04

ARG RUNNER_VERSION=2.311.0

# Install dependencies
RUN apt-get update && apt-get install -y \
    curl \
    jq \
    git \
    sudo \
    ca-certificates \
    gnupg \
    lsb-release \
    && rm -rf /var/lib/apt/lists/*

# Create runner user
RUN useradd -m -s /bin/bash runner && \
    usermod -aG sudo runner && \
    echo "runner ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers

WORKDIR /home/runner

# Download and extract GitHub runner
RUN curl -O -L https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz && \
    tar xzf actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz && \
    rm actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz && \
    chown -R runner:runner /home/runner

# Copy hook scripts
COPY hooks/ /home/runner/hooks/
RUN chmod +x /home/runner/hooks/*.sh && \
    chown -R runner:runner /home/runner/hooks

# Copy entrypoint script
COPY docker/proxy-runner/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Install dependencies as runner user
USER runner
RUN ./bin/installdependencies.sh

# Environment variables
ENV RUNNER_ALLOW_RUNASROOT=0 \
    RUNNER_NAME=proxy-runner \
    RUNNER_WORK_DIRECTORY=_work \
    ACTIONS_RUNNER_PRINT_LOG_TO_STDOUT=1

ENTRYPOINT ["/entrypoint.sh"]