# Contributing to GitHub RunnerHub

Thank you for your interest in contributing to GitHub RunnerHub! We welcome contributions from the community and are grateful for any help you can provide.

## Code of Conduct

By participating in this project, you agree to abide by our Code of Conduct: be respectful, inclusive, and constructive in all interactions.

## How to Contribute

### Reporting Issues

1. Check if the issue already exists
2. Create a new issue with a clear title and description
3. Include steps to reproduce, expected behavior, and actual behavior
4. Add relevant labels (bug, enhancement, documentation, etc.)

### Submitting Pull Requests

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Run tests and ensure they pass
5. Commit your changes (`git commit -m 'Add amazing feature'`)
6. Push to your branch (`git push origin feature/amazing-feature`)
7. Open a Pull Request

### Development Setup

```bash
# Clone your fork
git clone https://github.com/YOUR_USERNAME/GitHub-RunnerHub.git
cd GitHub-RunnerHub

# Install dependencies
cd backend && npm install
cd ../frontend && npm install

# Set up environment
cp .env.example .env
# Edit .env with your configuration

# Run development servers
# Terminal 1 - Backend
cd backend && npm run dev

# Terminal 2 - Frontend  
cd frontend && npm run dev
```

### Coding Standards

- Use TypeScript for type safety
- Follow existing code style
- Write meaningful commit messages
- Add tests for new features
- Update documentation as needed

### Testing

```bash
# Backend tests
cd backend && npm test

# Frontend tests
cd frontend && npm test

# Type checking
cd frontend && npm run type-check

# Docker build test
docker-compose build
```

### Documentation

- Update README.md for user-facing changes
- Add JSDoc comments for new functions
- Update API documentation for endpoint changes
- Include examples for new features

## Project Structure

```
GitHub-RunnerHub/
├── backend/           # Express.js API server
├── frontend/          # React dashboard
├── .github/          # GitHub Actions workflows
└── docs/             # Additional documentation
```

## Questions?

Feel free to open an issue or start a discussion if you have questions!