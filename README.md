# GitHub RunnerHub

<div align="center">
  <h1 style="background: linear-gradient(135deg, #ff6500 0%, #ff8533 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; color: transparent;">
    GitHub RunnerHub
  </h1>
  <p><strong>Dynamic GitHub Actions Runner Management with Auto-Scaling</strong></p>
  
  ![License](https://img.shields.io/badge/license-MIT-orange.svg)
  ![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-orange.svg)
  ![Docker](https://img.shields.io/badge/docker-%3E%3D20.0.0-orange.svg)
  
  <p>
    <a href="#features">Features</a> •
    <a href="#quick-start">Quick Start</a> •
    <a href="#architecture">Architecture</a> •
    <a href="#installation">Installation</a> •
    <a href="#configuration">Configuration</a> •
    <a href="#api">API</a>
  </p>
</div>

## 🚀 Overview

GitHub RunnerHub is a comprehensive self-hosted GitHub Actions runner management system with intelligent auto-scaling capabilities. It automatically spawns new runners when capacity reaches 80-90%, ensuring your CI/CD pipelines never wait for available resources.

## ✨ Features

- **🔄 Dynamic Auto-Scaling**: Automatically spawns 5 new runners when 80-90% capacity is reached
- **📊 Real-Time Monitoring**: Live dashboard showing runner status, active jobs, and utilization metrics
- **🎨 Modern UI**: Black and orange themed interface matching ProjectHub-Mcp design
- **🐳 Docker-Based**: Fully containerized for easy deployment and management
- **🔧 Easy Installation**: One-command setup with interactive configuration
- **📈 Performance Metrics**: Track runner utilization, job duration, and workflow performance
- **🔒 Secure**: Token-based authentication with secure storage
- **🌐 REST API**: Full API for programmatic runner management

## 🏃 Quick Start

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

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│                 │     │                 │     │                 │
│  GitHub API     │◄────│  Backend API    │◄────│  Auto-Scaler    │
│                 │     │  (Node.js)      │     │  Engine         │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                              ▲                          │
                              │                          ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│                 │     │                 │     │                 │
│  Monitoring     │────►│  WebSocket      │     │  Runner Pool    │
│  Dashboard      │     │  Server         │     │  (Docker)       │
│                 │     │                 │     │                 │
└─────────────────┘     └─────────────────┘     └─────────────────┘
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

Connect to `ws://localhost:8300/ws` for real-time updates:

- `runner:status` - Runner status changes
- `workflow:start` - Workflow started
- `workflow:complete` - Workflow completed
- `metrics:update` - Metrics updated

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

- GitHub tokens are stored securely and never exposed
- All API endpoints require authentication
- Runner tokens are rotated automatically
- TLS/SSL support for production deployments

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Inspired by [ProjectHub-Mcp](https://github.com/anubissbe/ProjectHub-Mcp) design system
- Built with React, Node.js, and Docker
- Powered by GitHub Actions API

---

<div align="center">
  <p>Made with ❤️ by the GitHub RunnerHub Team</p>
  <p>
    <a href="https://github.com/anubissbe/GitHub-RunnerHub">GitHub</a> •
    <a href="https://github.com/anubissbe/GitHub-RunnerHub/issues">Issues</a> •
    <a href="https://github.com/anubissbe/GitHub-RunnerHub/discussions">Discussions</a>
  </p>
</div>