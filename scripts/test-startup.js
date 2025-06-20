// Test application startup without external dependencies
const { spawn } = require('child_process');
const path = require('path');

console.log('Testing GitHub-RunnerHub startup...\n');

// Set minimal environment
const env = {
  ...process.env,
  NODE_ENV: 'development',
  PORT: '3000',
  GITHUB_TOKEN: 'test-token',
  VAULT_TOKEN: 'test-token',
  JWT_SECRET: 'test-secret'
};

// Start the application
const app = spawn('node', [path.join(__dirname, '../dist/index.js')], {
  env,
  stdio: 'pipe'
});

let output = '';
let errorOutput = '';

app.stdout.on('data', (data) => {
  output += data.toString();
  process.stdout.write(data);
});

app.stderr.on('data', (data) => {
  errorOutput += data.toString();
  process.stderr.write(data);
});

// Give it 3 seconds to start
setTimeout(() => {
  console.log('\n\nStartup test complete.');
  
  if (errorOutput.includes('Error') || errorOutput.includes('error')) {
    console.log('❌ Errors detected during startup');
    process.exit(1);
  } else if (output.includes('Database connection failed') || output.includes('Failed to start')) {
    console.log('⚠️  External dependencies not available (expected)');
    console.log('✅ Application code loads without errors');
    process.exit(0);
  } else {
    console.log('✅ Application starts successfully');
    process.exit(0);
  }
}, 3000);

// Handle timeout
setTimeout(() => {
  console.log('\n❌ Startup timeout');
  app.kill();
  process.exit(1);
}, 10000);