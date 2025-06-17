const WebSocket = require('ws');
const request = require('supertest');

jest.mock('dockerode');
jest.mock('@octokit/rest');

describe('WebSocket Integration Tests', () => {
  let app;
  let server;
  let ws;
  let port;
  
  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret';
    process.env.GITHUB_TOKEN = 'test-token';
    process.env.GITHUB_ORG = 'test-org';
    process.env.GITHUB_REPO = 'test-repo';
    
    const createApp = require('../../server');
    app = createApp();
    
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        port = server.address().port;
        resolve();
      });
    });
  });
  
  afterEach(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
  });
  
  afterAll(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });
  
  describe('WebSocket Connection', () => {
    test('Should connect successfully', async () => {
      ws = new WebSocket(`ws://localhost:${port}`);
      
      await new Promise((resolve, reject) => {
        ws.on('open', resolve);
        ws.on('error', reject);
      });
      
      expect(ws.readyState).toBe(WebSocket.OPEN);
    });
    
    test('Should receive connected message', async () => {
      ws = new WebSocket(`ws://localhost:${port}`);
      
      const message = await new Promise((resolve) => {
        ws.on('message', (data) => {
          resolve(JSON.parse(data));
        });
      });
      
      expect(message).toHaveProperty('event', 'connected');
      expect(message.data).toHaveProperty('message');
    });
    
    test('Should receive update events', async () => {
      ws = new WebSocket(`ws://localhost:${port}`);
      
      const messages = [];
      ws.on('message', (data) => {
        messages.push(JSON.parse(data));
      });
      
      // Wait for connection
      await new Promise((resolve) => {
        ws.on('open', resolve);
      });
      
      // Trigger an update by making an API call
      await request(app).get('/api/public/status');
      
      // Wait for potential update message
      await new Promise(resolve => setTimeout(resolve, 100));
      
      expect(messages.length).toBeGreaterThan(0);
      expect(messages[0]).toHaveProperty('event');
    });
  });
  
  describe('Multiple Clients', () => {
    test('Should handle multiple WebSocket connections', async () => {
      const clients = [];
      const messages = [];
      
      // Connect 5 clients
      for (let i = 0; i < 5; i++) {
        const client = new WebSocket(`ws://localhost:${port}`);
        
        client.on('message', (data) => {
          messages.push({
            client: i,
            message: JSON.parse(data)
          });
        });
        
        clients.push(client);
      }
      
      // Wait for all to connect
      await Promise.all(
        clients.map(client => 
          new Promise((resolve) => {
            client.on('open', resolve);
          })
        )
      );
      
      // All should be connected
      expect(clients.every(c => c.readyState === WebSocket.OPEN)).toBe(true);
      
      // All should have received connected message
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(messages.length).toBe(5);
      
      // Clean up
      clients.forEach(c => c.close());
    });
  });
  
  describe('Error Handling', () => {
    test('Should handle client disconnect gracefully', async () => {
      ws = new WebSocket(`ws://localhost:${port}`);
      
      await new Promise((resolve) => {
        ws.on('open', resolve);
      });
      
      // Abruptly close connection
      ws.terminate();
      
      // Server should continue running
      const response = await request(app).get('/health');
      expect(response.status).toBe(200);
    });
    
    test('Should handle invalid messages', async () => {
      ws = new WebSocket(`ws://localhost:${port}`);
      
      await new Promise((resolve) => {
        ws.on('open', resolve);
      });
      
      // Send invalid JSON
      ws.send('invalid json{');
      
      // Connection should remain open
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(ws.readyState).toBe(WebSocket.OPEN);
    });
  });
});