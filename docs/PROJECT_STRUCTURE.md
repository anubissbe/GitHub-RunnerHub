# Project Structure

## Directory Layout

```
GitHub-RunnerHub/
├── src/                       # Source code
│   ├── app.ts                # Express application setup
│   ├── index.ts              # Application entry point
│   ├── config/               # Configuration management
│   │   └── index.ts         # Config loader with defaults
│   ├── controllers/          # REST API controllers
│   │   ├── audit-controller.ts
│   │   ├── auth-controller.ts
│   │   ├── cleanup-controller.ts
│   │   ├── container-controller.ts
│   │   ├── job-controller.ts
│   │   ├── monitoring-controller.ts
│   │   ├── network-controller.ts
│   │   ├── routing-controller.ts
│   │   ├── runner-controller.ts
│   │   ├── scaling-controller.ts
│   │   ├── security-controller.ts
│   │   ├── system-controller.ts
│   │   └── webhook-controller.ts
│   ├── middleware/           # Express middleware
│   │   ├── async-handler.ts
│   │   ├── auth.ts
│   │   ├── error-handler.ts
│   │   ├── rate-limiter.ts
│   │   ├── request-logger.ts
│   │   └── webhook-middleware.ts
│   ├── routes/               # API route definitions
│   │   ├── audit.ts
│   │   ├── auth.ts
│   │   ├── cleanup.ts
│   │   ├── containers.ts
│   │   ├── health.ts
│   │   ├── jobs.ts
│   │   ├── metrics.ts
│   │   ├── monitoring.ts
│   │   ├── networks.ts
│   │   ├── routing.ts
│   │   ├── runners.ts
│   │   ├── scaling.ts
│   │   ├── security.ts
│   │   ├── system.ts
│   │   └── webhook-routes.ts
│   ├── services/             # Business logic services
│   │   ├── audit-logger.ts
│   │   ├── auto-scaler.ts
│   │   ├── container-cleanup.ts
│   │   ├── container-lifecycle.ts
│   │   ├── container-orchestrator-v2.ts
│   │   ├── container-orchestrator.ts
│   │   ├── database.ts
│   │   ├── github-api.ts
│   │   ├── github-webhook.ts
│   │   ├── job-queue.ts
│   │   ├── job-router.ts
│   │   ├── monitoring.ts
│   │   ├── network-isolation.ts
│   │   ├── proxy-runner.ts
│   │   ├── runner-pool-manager.ts
│   │   ├── security-scanner.ts
│   │   ├── service-manager.ts
│   │   └── vault-service.ts
│   ├── types/                # TypeScript type definitions
│   │   └── index.ts
│   └── utils/                # Utility functions
│       ├── errors.ts
│       └── logger.ts
│
├── tests/                    # Test suites
│   ├── e2e/                 # End-to-end tests
│   │   ├── audit-logging.e2e.test.js
│   │   ├── complete-workflow.e2e.test.js
│   │   ├── network-isolation.e2e.test.js
│   │   └── security-scanning.test.ts
│   ├── services/            # Service unit tests
│   │   ├── auto-scaler.test.ts
│   │   ├── container-cleanup.test.ts
│   │   ├── container-lifecycle.test.ts
│   │   ├── github-webhook.test.ts
│   │   ├── job-router.test.ts
│   │   └── monitoring.test.ts
│   └── unit/                # Unit tests
│       ├── auth-controller.test.ts
│       └── auth-middleware.test.ts
│
├── migrations/               # Database migrations
│   ├── 001_initial_schema.sql
│   ├── 002_add_containers_table.sql
│   ├── 003_create_users_table.sql
│   ├── 004_create_network_isolation_table.sql
│   ├── 005_create_audit_logs_table.sql
│   └── 006_create_security_scanning_tables.sql
│
├── docker/                   # Docker configurations
│   ├── orchestrator/        # Orchestrator Dockerfile
│   │   └── Dockerfile
│   ├── postgres/            # PostgreSQL initialization
│   │   └── init.sql
│   └── proxy-runner/        # Proxy runner container
│       ├── Dockerfile
│       └── entrypoint.sh
│
├── infrastructure/          # Infrastructure configurations
│   └── postgres/           # Database infrastructure
│       └── migrations/     # Additional migrations
│
├── scripts/                 # Utility scripts
│   ├── run-e2e-tests.sh
│   ├── run-migrations.sh
│   ├── setup-vault-secrets.sh
│   ├── test-auth.sh
│   ├── test-cleanup.sh
│   ├── test-security-scanning.ts
│   ├── test-startup.js
│   ├── test-webhook-integration.sh
│   └── verify-build.sh
│
├── hooks/                   # GitHub Actions hooks
│   ├── job-completed.sh
│   └── job-started.sh
│
├── public/                  # Static web assets
│   ├── index.html          # Dashboard HTML
│   └── js/
│       └── dashboard.js    # Dashboard JavaScript
│
├── docs/                    # Documentation
│   ├── features/           # Feature documentation
│   │   ├── audit-logging.md
│   │   ├── container-security-scanning.md
│   │   └── network-isolation.md
│   ├── API_REFERENCE.md
│   ├── AUDIT_LOGGING.md
│   ├── AUTO_SCALING.md
│   ├── CONTAINER_CLEANUP.md
│   ├── CONTAINER_LIFECYCLE_MANAGEMENT.md
│   ├── DEVELOPMENT_GUIDE.md
│   ├── GITHUB_WEBHOOK_INTEGRATION.md
│   ├── JOB_ROUTING.md
│   ├── MONITORING_DASHBOARD.md
│   ├── NETWORK_ISOLATION.md
│   ├── PROJECT_STRUCTURE.md
│   ├── PROXY_RUNNER_HOOKS.md
│   └── RUNNER_POOL_MANAGEMENT.md
│
├── logs/                    # Application logs
│   └── .gitkeep
│
├── .env.example            # Example environment configuration
├── .gitignore             # Git ignore rules
├── ARCHITECTURE.md        # System architecture
├── docker-compose.yml     # Docker compose configuration
├── eslint.config.js       # ESLint configuration
├── jest.config.js         # Jest test configuration
├── package.json           # Node.js dependencies
├── package-lock.json      # Dependency lock file
├── PROJECT_STATE.md       # Project state tracking
├── PROJECT_STATE_FINAL.md # Final project summary
├── README.md              # Project documentation
├── TODO.md                # Task tracking
└── tsconfig.json          # TypeScript configuration
```

## Key Directories

### `/src`
Contains all source code organized by function:
- **controllers**: Handle HTTP requests and responses
- **services**: Business logic and external integrations
- **middleware**: Request processing pipeline
- **routes**: API endpoint definitions
- **types**: Shared TypeScript interfaces
- **utils**: Helper functions

### `/tests`
Organized test suites:
- **e2e**: End-to-end integration tests
- **services**: Service-level unit tests
- **unit**: Individual component tests

### `/migrations`
Database schema evolution:
- Sequential SQL files
- Applied in order during setup

### `/docker`
Container definitions:
- Each service has its own directory
- Includes Dockerfiles and entry scripts

### `/docs`
Comprehensive documentation:
- Feature-specific guides in `/features`
- API and development documentation

### `/scripts`
Automation and utility scripts:
- Testing helpers
- Migration runners
- Setup utilities

## File Naming Conventions

- **Controllers**: `<feature>-controller.ts`
- **Services**: `<feature>-service.ts` or `<feature>.ts`
- **Routes**: `<feature>.ts`
- **Tests**: `<file>.test.ts` or `<file>.e2e.test.js`
- **Migrations**: `<number>_<description>.sql`

## Configuration Files

- `.env.example`: Template for environment variables
- `tsconfig.json`: TypeScript compiler options
- `jest.config.js`: Test runner configuration
- `eslint.config.js`: Code style rules
- `docker-compose.yml`: Multi-container setup

## Build Artifacts

The following directories are generated and should not be committed:
- `/dist`: Compiled JavaScript output
- `/node_modules`: NPM dependencies
- `/coverage`: Test coverage reports
- `/logs/*.log`: Application log files