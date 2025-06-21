import { config as dotenvConfig } from 'dotenv';
import config from './config';
import { createLogger } from './utils/logger';
import express from 'express';
import path from 'path';

// Load environment variables
dotenvConfig();

const logger = createLogger('Main');

async function startSimpleServer() {
  try {
    logger.info('Starting simplified server...');
    
    const app = express();
    
    // Health check endpoint
    app.get('/health', (_req, res) => {
      res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        environment: config.app.env,
        redis: {
          host: config.redis.host,
          port: config.redis.port,
          connected: false
        },
        database: {
          connected: false
        }
      });
    });
    
    // Dashboard route
    app.get('/dashboard', (_req, res) => {
      res.sendFile(path.join(__dirname, '../public/index.html'));
    });
    
    // Static files
    app.use(express.static(path.join(__dirname, '../public')));
    
    // API info
    app.get('/api', (_req, res) => {
      res.json({
        name: 'GitHub RunnerHub',
        version: '1.0.0',
        status: 'running (simplified)',
        endpoints: {
          health: '/health',
          dashboard: '/dashboard'
        }
      });
    });
    
    const port = config.app.port || 3001;
    app.listen(port, '0.0.0.0', () => {
      logger.info(`Simplified server listening on port ${port}`);
      logger.info(`Health check: http://0.0.0.0:${port}/health`);
      logger.info(`Dashboard: http://0.0.0.0:${port}/dashboard`);
    });
    
  } catch (error) {
    logger.error('Failed to start simplified server', { error });
    process.exit(1);
  }
}

// Start the server
startSimpleServer();