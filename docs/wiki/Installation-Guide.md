# Installation Guide

This guide will walk you through installing GitHub RunnerHub on your server.

## Prerequisites

Before installing RunnerHub, ensure you have:

- **Operating System**: Ubuntu 20.04+ or similar Linux distribution
- **Docker**: Version 20.10 or higher
- **Docker Compose**: Version 2.0 or higher
- **Hardware**: Minimum 4GB RAM, 20GB storage
- **Network**: Outbound HTTPS access to GitHub
- **GitHub Token**: Personal Access Token with `repo` and `admin:org` scopes

## Installation Methods

### 🚀 Quick Install (Recommended)

The easiest way to install RunnerHub:

```bash
# Clone the repository
git clone https://github.com/anubissbe/GitHub-RunnerHub.git
cd GitHub-RunnerHub

# Run the installer
./install.sh
```

The installer will:
1. Check system requirements
2. Prompt for your GitHub token
3. Configure the environment
4. Build Docker images
5. Start all services
6. Display dashboard URL

### 📦 Manual Installation

For advanced users who need custom configuration:

#### Step 1: Clone Repository
```bash
git clone https://github.com/anubissbe/GitHub-RunnerHub.git
cd GitHub-RunnerHub
```

#### Step 2: Configure Environment
```bash
cp .env.example .env
nano .env
```

Edit the following variables:
```env
# Required
GITHUB_TOKEN=ghp_xxxxxxxxxxxxx      # Your GitHub PAT
GITHUB_ORG=your-username            # GitHub username or org
GITHUB_REPO=your-repo               # Primary repository

# Optional
MIN_RUNNERS=5                       # Minimum runners
MAX_RUNNERS=25                      # Maximum runners
SCALE_UP_THRESHOLD=70               # Scale up at % busy
SCALE_DOWN_THRESHOLD=30             # Scale down at % busy
```

#### Step 3: Build and Start
```bash
# Build images
docker-compose build

# Start services
docker-compose up -d

# Check status
docker-compose ps
```

#### Step 4: Verify Installation
```bash
# Check backend health
curl http://localhost:8300/health

# View logs
docker-compose logs -f
```

## Post-Installation Setup

### 1. Access the Dashboard
Open your browser and navigate to:
```
http://your-server-ip:8080
```

Default credentials:
- Username: `admin`
- Password: `admin` (change immediately!)

### 2. Configure Repositories

Update your GitHub Actions workflows to use the self-hosted runners:

```yaml
jobs:
  build:
    runs-on: [self-hosted, docker, runnerhub]
    steps:
      - uses: actions/checkout@v3
      - name: Build
        run: npm run build
```

### 3. Test the System

Create a test workflow in your repository:

```yaml
name: Test RunnerHub
on: [push]

jobs:
  test:
    runs-on: [self-hosted, docker, runnerhub]
    steps:
      - run: echo "Hello from RunnerHub!"
      - run: docker --version
      - run: node --version
```

### 4. Configure Auto-Scaling

Edit `config/autoscaler.json`:
```json
{
  "minRunners": 5,
  "maxRunners": 25,
  "scaleUpThreshold": 70,
  "scaleDownThreshold": 30,
  "checkInterval": 30,
  "idleTimeout": 300
}
```

## Troubleshooting Installation

### Docker Not Found
```bash
# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER
```

### Permission Denied
```bash
# Fix Docker socket permissions
sudo chmod 666 /var/run/docker.sock
```

### Port Already in Use
```bash
# Change ports in docker-compose.yml
# Or stop conflicting service:
sudo lsof -i :8080
sudo kill -9 <PID>
```

### Token Invalid
Ensure your GitHub token has these permissions:
- `repo` (Full control of private repositories)
- `admin:org` (Read and write org runner groups)
- `workflow` (Update GitHub Action workflows)

## Next Steps

- 📊 [Configure the Dashboard](Dashboard-Guide)
- 🔧 [Set Up Auto-Scaling](Auto-Scaling-Setup)
- 🏢 [Enable Multi-Repository Support](Multi-Repository-Support)
- 🔒 [Secure Your Installation](Security-Best-Practices)

---

Need help? Check our [Troubleshooting Guide](Troubleshooting) or [open an issue](https://github.com/anubissbe/GitHub-RunnerHub/issues).