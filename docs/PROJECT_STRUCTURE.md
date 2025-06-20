# Project Structure

## Directory Layout

```
GitHub-RunnerHub/
├── src/                      # Source code
│   ├── controllers/          # API controllers
│   ├── middleware/           # Express middleware
│   ├── routes/               # API routes
│   ├── services/             # Business logic
│   ├── types/                # TypeScript definitions
│   ├── utils/                # Utility functions
│   ├── app.ts               # Express application
│   └── index.ts             # Entry point
│
├── dist/                     # Compiled JavaScript
│
├── public/                   # Static files
│   ├── index.html           # Dashboard HTML
│   └── js/                  # Client-side JavaScript
│
├── docker/                   # Docker configurations
│   ├── postgres/            # PostgreSQL init scripts
│   ├── redis/               # Redis configuration
│   └── nginx/               # Nginx configuration
│
├── scripts/                  # Utility scripts
│   ├── ha/                  # High availability scripts
│   ├── monitoring/          # Monitoring scripts
│   └── setup-*.sh           # Setup scripts
│
├── config/                   # Configuration files
│   ├── haproxy.cfg         # HAProxy configuration
│   └── redis-sentinel.conf  # Redis Sentinel config
│
├── docs/                     # Documentation
│   ├── api/                 # API documentation
│   ├── features/            # Feature documentation
│   ├── ARCHITECTURE.md      # Architecture overview
│   └── DEPLOYMENT_GUIDE.md  # Deployment guide
│
├── test/                     # Test files
│   ├── unit/                # Unit tests
│   ├── integration/         # Integration tests
│   └── e2e/                 # End-to-end tests
│
├── infrastructure/           # Infrastructure code
│   └── postgres/            # Database schemas
│
├── .github/                  # GitHub specific files
│   └── workflows/           # GitHub Actions
│
├── docker-compose.yml        # Standard deployment
├── docker-compose.ha.yml     # HA deployment
├── docker-compose.remote.yml # Remote deployment
├── package.json             # Node.js dependencies
├── tsconfig.json            # TypeScript config
├── .env.example             # Environment template
├── .gitignore               # Git ignore rules
├── LICENSE                  # MIT license
└── README.md                # Project documentation
```

## Key Files

### Configuration Files
- `.env.example` - Environment variable template
- `tsconfig.json` - TypeScript compiler configuration
- `docker-compose.yml` - Docker service definitions
- `config/` - Various service configurations

### Entry Points
- `src/index.ts` - Main application entry point
- `src/app.ts` - Express application setup
- `public/index.html` - Dashboard UI entry point

### Scripts
- `quick-start.sh` - Local development setup
- `remote-quick-start.sh` - Remote deployment configuration
- `deploy-to-remote.sh` - Automated remote deployment
- `install.sh` - Full installation script
- `verify-installation.sh` - Installation verification

### Documentation
- `README.md` - Main project documentation
- `docs/ARCHITECTURE.md` - System architecture
- `docs/DEPLOYMENT_GUIDE.md` - Deployment instructions
- `docs/api/` - API documentation
- `docs/features/` - Feature-specific guides

## Development Workflow

1. **Source Code**: All TypeScript source in `src/`
2. **Compilation**: TypeScript compiles to `dist/`
3. **Static Files**: Dashboard UI in `public/`
4. **Configuration**: Environment variables in `.env`
5. **Deployment**: Docker Compose orchestration
6. **Testing**: Comprehensive test suite in `test/`

## Best Practices

1. **Keep secrets out of version control** - Use `.env.example` as template
2. **Document new features** - Add to `docs/features/`
3. **Test before committing** - Run `npm test`
4. **Update deployment scripts** - Maintain compatibility
5. **Follow TypeScript conventions** - Strict mode enabled