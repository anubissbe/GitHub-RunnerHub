# GitHub RunnerHub Technology Stack

This directory contains comprehensive documentation for all technologies used in the GitHub RunnerHub project. Each technology has been documented with key concepts, best practices, integration patterns, and specific implementations for the RunnerHub system.

## Backend Technologies

### Core Runtime & Framework
- **[Node.js](./nodejs.md)** - JavaScript runtime environment
  - Event-driven architecture
  - Async/await patterns
  - Performance optimization
  - GitHub RunnerHub specific patterns

- **[Express.js](./express.md)** - Web application framework
  - Middleware architecture
  - Routing patterns
  - Error handling
  - Security best practices

### Container & Infrastructure
- **[Docker](./docker.md)** - Container platform
  - Container lifecycle management
  - Image optimization
  - Docker Compose patterns
  - GitHub Actions runner containers

- **[Dockerode](./dockerode.md)** - Node.js Docker API client
  - Container management
  - Image operations
  - Volume and network management
  - Real-time monitoring

### Real-time Communication
- **[WebSocket (ws)](./websocket.md)** - Real-time bidirectional communication
  - Client management
  - Message protocols
  - Binary data handling
  - Live log streaming

### GitHub Integration
- **[Octokit](./octokit.md)** - Official GitHub API client
  - Repository management
  - Workflow and job operations
  - Webhook processing
  - GraphQL operations

### Security & Authentication
- **[CORS](./cors.md)** - Cross-Origin Resource Sharing
  - Origin validation
  - Preflight handling
  - Per-route configuration
  - Security considerations

- **[JWT](./jwt.md)** - JSON Web Tokens for authentication
  - Token generation and validation
  - Refresh token patterns
  - Multi-tenant JWT
  - Security best practices

- **[bcrypt](./bcrypt.md)** - Password hashing library
  - Secure password storage
  - Salt rounds optimization
  - API key management
  - Migration strategies

### Configuration
- **[dotenv](./dotenv.md)** - Environment variable management
  - Multi-environment setup
  - Secrets management
  - Type-safe configuration
  - Security considerations

## Quick Reference

### Installation
```bash
# Install all backend dependencies
npm install express dockerode ws @octokit/rest cors jsonwebtoken bcrypt dotenv
```

### Basic Setup Example
```javascript
// Load environment variables
import dotenv from 'dotenv';
dotenv.config();

// Initialize Express with security
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';

const app = express();

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGINS?.split(',') || 'http://localhost:3000',
  credentials: true
}));

// Authentication
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';

const authService = {
  hashPassword: (password) => bcrypt.hash(password, 12),
  verifyPassword: (password, hash) => bcrypt.compare(password, hash),
  generateToken: (user) => jwt.sign({ sub: user.id }, process.env.JWT_SECRET),
  verifyToken: (token) => jwt.verify(token, process.env.JWT_SECRET)
};

// Docker integration
import Docker from 'dockerode';
const docker = new Docker({ socketPath: '/var/run/docker.sock' });

// GitHub integration
import { Octokit } from '@octokit/rest';
const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

// WebSocket server
import { WebSocketServer } from 'ws';
const wss = new WebSocketServer({ port: 8080 });

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`RunnerHub API running on port ${PORT}`);
});
```

## Integration Patterns

### 1. GitHub Runner Management Flow
```javascript
// Uses: Express, Dockerode, Octokit, JWT, WebSocket
async function createRunner(req, res) {
  // Authenticate user (JWT)
  const user = await authService.verifyToken(req.token);
  
  // Get registration token from GitHub (Octokit)
  const { token } = await githubService.createRegistrationToken(
    req.body.owner,
    req.body.repo
  );
  
  // Create runner container (Dockerode)
  const container = await dockerService.createRunnerContainer({
    name: req.body.name,
    token: token,
    labels: req.body.labels
  });
  
  // Notify via WebSocket
  wsService.broadcast({
    type: 'runner:created',
    runner: { id: container.id, name: req.body.name }
  });
  
  res.json({ success: true, runnerId: container.id });
}
```

### 2. Secure API Endpoint Pattern
```javascript
// Uses: Express, CORS, JWT, bcrypt
app.post('/api/login',
  cors(corsOptions),                    // CORS protection
  rateLimiter,                          // Rate limiting
  async (req, res, next) => {
    try {
      // Validate credentials (bcrypt)
      const user = await User.findOne({ email: req.body.email });
      const isValid = await bcrypt.compare(req.body.password, user.password);
      
      if (!isValid) throw new Error('Invalid credentials');
      
      // Generate tokens (JWT)
      const tokens = jwtService.generateTokens(user);
      
      res.json(tokens);
    } catch (error) {
      next(error);
    }
  }
);
```

### 3. Real-time Updates Pattern
```javascript
// Uses: WebSocket, Docker events, JWT
class RealtimeUpdates {
  constructor(wss, docker) {
    // Authenticate WebSocket connections
    wss.on('connection', (ws, req) => {
      const token = extractToken(req);
      const user = jwt.verify(token, process.env.JWT_SECRET);
      
      // Subscribe to Docker events
      docker.getEvents((err, stream) => {
        stream.on('data', (chunk) => {
          const event = JSON.parse(chunk);
          ws.send(JSON.stringify({
            type: 'docker:event',
            event
          }));
        });
      });
    });
  }
}
```

## Best Practices Summary

### Security
1. Always use HTTPS in production
2. Implement proper CORS policies
3. Use strong JWT secrets (64+ characters)
4. Hash passwords with bcrypt (12+ rounds)
5. Never commit .env files
6. Validate and sanitize all inputs
7. Implement rate limiting
8. Use security headers (helmet)

### Performance
1. Use connection pooling for databases
2. Implement caching strategies
3. Optimize Docker images
4. Use WebSocket for real-time updates
5. Implement proper error handling
6. Monitor resource usage
7. Use compression middleware

### Development
1. Use TypeScript for type safety
2. Follow modular architecture
3. Write comprehensive tests
4. Document API endpoints
5. Use environment-specific configs
6. Implement proper logging
7. Use linting and formatting tools

## Resources

- [Node.js Best Practices](https://github.com/goldbergyoni/nodebestpractices)
- [Express.js Production Best Practices](https://expressjs.com/en/advanced/best-practice-performance.html)
- [Docker Security Best Practices](https://docs.docker.com/engine/security/)
- [OWASP Security Guidelines](https://owasp.org/)

## Contributing

When adding new technologies to the stack:
1. Create a comprehensive documentation file following the existing pattern
2. Include integration examples specific to GitHub RunnerHub
3. Add security considerations
4. Provide testing examples
5. Update this index file