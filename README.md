# 🏃 GitHub RunnerHub

<div align="center">

![GitHub RunnerHub](https://img.shields.io/badge/GitHub-RunnerHub-ff6500?style=for-the-badge&logo=github-actions&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-0a0a0a?style=for-the-badge)
![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?style=for-the-badge&logo=docker&logoColor=white)
![Status](https://img.shields.io/badge/Status-Production-00ff00?style=for-the-badge)

**Enterprise-grade self-hosted GitHub Actions runner infrastructure with auto-scaling, monitoring, and multi-repository support**

[Installation](#-installation) • [Features](#-features) • [Architecture](#-architecture) • [Wiki](https://github.com/anubissbe/GitHub-RunnerHub/wiki) • [Support](#-support)

<a href="https://www.buymeacoffee.com/anubissbe" target="_blank">
  <img src="https://cdn.buymeacoffee.com/buttons/v2/default-orange.png" alt="Buy Me A Coffee" height="60" width="217">
</a>

</div>

---

## 🚀 Features

- **🔄 Auto-Scaling**: Dynamically scales runners based on workload (5-25 runners)
- **📊 Real-time Dashboard**: Monitor runners, workflows, and metrics at a glance
- **🏢 Multi-Repository**: Single infrastructure serves all your repositories
- **🔐 Secure**: Runs in Docker containers with isolated environments
- **💰 Cost-Effective**: Eliminate GitHub Actions minutes charges
- **🔡 Token Refresh**: Automatic token renewal prevents runner disconnections
- **🎨 Beautiful UI**: Black/orange themed dashboard matching your brand

## 📸 Screenshots

<div align="center">
  <img src="docs/images/dashboard.png" alt="RunnerHub Dashboard" width="800">
  <p><i>Real-time monitoring dashboard showing runner status and metrics</i></p>
</div>

## ⚡ Quick Start

```bash
# Clone the repository
git clone https://github.com/anubissbe/GitHub-RunnerHub.git
cd GitHub-RunnerHub

# Run the installer (requires only GitHub token)
./install.sh

# Access the dashboard
open http://localhost:8080
```

## 📋 Requirements

- Docker 20.10+
- Linux server (Ubuntu 20.04+ recommended)
- GitHub Personal Access Token with `repo` and `admin:org` scopes
- Minimum 4GB RAM, 20GB storage

## 🏗️ Architecture

```bash
# Clone the repository
git clone https://github.com/anubissbe/GitHub-RunnerHub.git
cd GitHub-RunnerHub

# Run the installer
./install.sh

# Follow the prompts to enter your GitHub token
# The installer will handle everything else!
```

## 🏗️ Architecture

```mermaid
graph TB
    subgraph "GitHub"
        GH[GitHub Actions]
        WF[Workflows]
    end
    
    subgraph "RunnerHub Infrastructure"
        AS[Auto-Scaler]
        RM[Runner Manager]
        TR[Token Refresher]
        
        subgraph "Runner Pool"
            R1[Runner 1]
            R2[Runner 2]
            R3[Runner ...]
            RN[Runner N]
        end
        
        subgraph "Monitoring"
            API[Backend API]
            WS[WebSocket]
            DB[Dashboard]
        end
    end
    
    GH -->|Register| RM
    WF -->|Job Request| R1
    WF -->|Job Request| R2
    AS -->|Scale Up/Down| RM
    RM -->|Manage| R1
    RM -->|Manage| R2
    RM -->|Manage| R3
    RM -->|Manage| RN
    TR -->|Refresh Tokens| RM
    API -->|Status| DB
    WS -->|Real-time Updates| DB
    
    style AS fill:#ff6500,stroke:#0a0a0a,stroke-width:2px
    style DB fill:#ff6500,stroke:#0a0a0a,stroke-width:2px
```

### Components

- **Monitoring Dashboard**: React-based UI with real-time updates
- **Backend API**: Express.js server managing runners and GitHub integration
- **Auto-Scaling Engine**: Intelligent scaling based on utilization thresholds
- **Runner Pool**: Docker containers running GitHub Actions runners
- **WebSocket Server**: Real-time communication for live updates

## 📦 Installation

### Prerequisites

- Docker 20.0.0 or higher
- Docker Compose 2.0.0 or higher
- Node.js 18.0.0 or higher (for development)
- GitHub Personal Access Token with `repo` and `admin:org` scopes

### Automated Installation

```bash
./install.sh
```

The installer will:
1. Check system requirements
2. Prompt for your GitHub token
3. Configure the environment
4. Build Docker images
5. Start the services
6. Display the dashboard URL

### Manual Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/anubissbe/GitHub-RunnerHub.git
   cd GitHub-RunnerHub
   ```

2. **Configure environment**
   ```bash
   cp .env.example .env
   # Edit .env and add your GITHUB_TOKEN
   ```

3. **Build and start services**
   ```bash
   docker-compose up -d
   ```

4. **Access the dashboard**
   ```
   http://localhost:8080
   ```

## ⚙️ Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `GITHUB_TOKEN` | GitHub Personal Access Token | Required |
| `GITHUB_ORG` | GitHub organization name | Required |
| `GITHUB_REPO` | Repository name | Required |
| `MIN_RUNNERS` | Minimum number of runners | 5 |
| `MAX_RUNNERS` | Maximum number of runners | 50 |
| `SCALE_THRESHOLD` | Utilization threshold for scaling | 0.8 |
| `SCALE_INCREMENT` | Number of runners to add | 5 |
| `API_PORT` | Backend API port | 8300 |
| `UI_PORT` | Dashboard UI port | 8080 |

### Auto-Scaling Configuration

Edit `config/scaling.json`:

```json
{
  "minRunners": 5,
  "maxRunners": 50,
  "scaleUpThreshold": 0.8,
  "scaleDownThreshold": 0.2,
  "scaleIncrement": 5,
  "cooldownPeriod": 300,
  "idleTimeout": 1800
}
```

## 🔌 API Reference

### Endpoints

#### Get Runner Status
```http
GET /api/runners
```

#### Get Active Workflows
```http
GET /api/workflows/active
```

#### Get Metrics
```http
GET /api/metrics
```

#### Scale Runners
```http
POST /api/runners/scale
{
  "action": "up" | "down",
  "count": 5
}
```

#### Health Check
```http
GET /health
```

### WebSocket Events

Connect to `ws://localhost:8300` for real-time updates:

- `connected` - Initial connection confirmation
- `scale` - Auto-scaling events (up/down with details)
- `update` - Cache updates with runner/workflow counts
- `runner:status` - Runner status changes
- `workflow:start` - Workflow started
- `workflow:complete` - Workflow completed
- `metrics:update` - Metrics updated

Example WebSocket client:
```javascript
const ws = new WebSocket('ws://localhost:8300');

ws.on('message', (data) => {
  const { event, data: payload } = JSON.parse(data);
  console.log(`Event: ${event}`, payload);
});
```

## 🎨 UI Customization

The UI follows the ProjectHub-Mcp design system:

- **Primary Color**: #ff6500 (Orange)
- **Background**: #0a0a0a (Near Black)
- **Surface**: #1a1a1a (Dark Gray)
- **Text**: #ffffff (White)

To customize, edit `frontend/src/styles/theme.css`.

## 🧪 Development

### Local Development

```bash
# Backend
cd backend
npm install
npm run dev

# Frontend
cd frontend
npm install
npm run dev
```

### Running Tests

```bash
npm test
```

### Building for Production

```bash
docker-compose build
```

## 📊 Monitoring

The dashboard provides:

- **Runner Overview**: Status of all runners (Ready, Busy, Offline)
- **Utilization Metrics**: Current usage percentage and trends
- **Active Workflows**: Real-time view of running workflows
- **Job Distribution**: Which runners are handling which jobs
- **Performance Stats**: Average job duration, queue times
- **Scaling History**: When and why scaling events occurred

## 🔒 Security

- GitHub tokens are stored securely in environment variables
- WebSocket connections include error handling and timestamps
- Docker socket access is controlled and monitored
- Health checks ensure service reliability
- TLS/SSL support ready for production deployments

## 📱 Screenshots

### Dashboard Overview
- Real-time runner status monitoring
- Live utilization metrics with charts
- Active workflow tracking
- Auto-scaling event history

### Auto-Scaling in Action
- Automatic runner spawning at 80% utilization
- Graceful scale-down during low usage
- Configurable thresholds and increments

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Inspired by [ProjectHub-Mcp](https://github.com/anubissbe/ProjectHub-Mcp) design system
- Built with React, Node.js, and Docker
- Powered by GitHub Actions API

## 💬 Support

- 📚 [Documentation Wiki](https://github.com/anubissbe/GitHub-RunnerHub/wiki)
- 🐛 [Issue Tracker](https://github.com/anubissbe/GitHub-RunnerHub/issues)
- 💬 [Discussions](https://github.com/anubissbe/GitHub-RunnerHub/discussions)
- ☕ [Buy Me a Coffee](https://www.buymeacoffee.com/anubissbe)

## 🙏 Acknowledgments

- Built with ❤️ using Docker and Node.js
- Inspired by the need for cost-effective CI/CD
- Special thanks to all contributors

---

<div align="center">

**If you find RunnerHub useful, please consider [buying me a coffee](https://www.buymeacoffee.com/anubissbe) ☕**

Made with 🧡 by [anubissbe](https://github.com/anubissbe)

</div>