# Changelog

All notable changes to GitHub RunnerHub will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Jarvis2.0 repository integration
  - Added to managed repositories list in `backend/server.js` and `backend/runner-manager.js`
  - Automatic dedicated runner creation: `runnerhub-dedicated-jarvis2-0`
  - Full auto-scaling support with 0-3 dynamic runners
- Comprehensive documentation for Jarvis2.0 integration in `docs/JARVIS2_INTEGRATION.md`

### Fixed
- Frontend API connectivity issue
  - Fixed 404 errors on `/api/public/runners` endpoint
  - Rebuilt frontend container with correct API URL (192.168.1.16:8300 instead of localhost)
  - Resolved Docker networking issue between frontend and backend containers

### Changed
- Updated repository count from 5 to 6 managed repositories
- Enhanced error handling in frontend API calls

## [2.0.0] - 2024-06-18

### Added
- Per-repository auto-scaling system
  - Dedicated runners (1 per repository)
  - Dynamic runners (0-3 per repository based on demand)
  - Automatic scale-down after 5 minutes idle
- Real-time WebSocket dashboard
- Public API endpoints (no authentication required)
- Comprehensive health check endpoint

### Changed
- Complete architecture overhaul from pool-based to per-repository scaling
- Improved runner naming convention
- Enhanced monitoring and metrics

## [1.0.0] - 2024-06-15

### Added
- Initial GitHub Actions self-hosted runner management
- Docker-based runner deployment
- Basic auto-scaling capabilities
- Web dashboard for monitoring
- Support for 5 repositories:
  - ai-music-studio
  - mcp-enhanced-workspace
  - JarvisAI
  - ProjectHub-Mcp
  - GitHub-RunnerHub