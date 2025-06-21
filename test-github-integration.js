#!/usr/bin/env node

/**
 * Test script for GitHub integration
 * 
 * Usage: node test-github-integration.js
 */

const fetch = require('node-fetch');

const API_BASE = 'http://localhost:3000/api';

async function testGitHubIntegration() {
  console.log('🧪 Testing GitHub Integration for RunnerHub Dashboard\n');

  try {
    // Test 1: Check system metrics endpoint
    console.log('1️⃣  Testing system metrics endpoint...');
    const metricsResponse = await fetch(`${API_BASE}/monitoring/system`);
    const metrics = await metricsResponse.json();
    
    if (metrics.success) {
      console.log('✅ System metrics endpoint working');
      console.log(`   - GitHub repositories tracked: ${metrics.data.github.repositories}`);
      console.log(`   - GitHub API rate limit: ${metrics.data.github.rateLimitStatus.remaining}/${metrics.data.github.rateLimitStatus.limit}`);
    } else {
      console.log('❌ System metrics endpoint failed');
    }

    // Test 2: Check dashboard endpoint
    console.log('\n2️⃣  Testing dashboard endpoint...');
    const dashboardResponse = await fetch(`${API_BASE}/monitoring/dashboard`);
    const dashboard = await dashboardResponse.json();
    
    if (dashboard.success) {
      console.log('✅ Dashboard endpoint working');
      console.log(`   - GitHub integration: ${dashboard.data.githubIntegration.enabled ? 'Enabled' : 'Disabled'}`);
      console.log(`   - Tracked repositories: ${dashboard.data.githubIntegration.repositories.join(', ') || 'None'}`);
      console.log(`   - Recent jobs count: ${dashboard.data.recentJobs.length}`);
    } else {
      console.log('❌ Dashboard endpoint failed');
    }

    // Test 3: Check tracked repositories
    console.log('\n3️⃣  Testing repository management...');
    const reposResponse = await fetch(`${API_BASE}/monitoring/repositories`);
    const repos = await reposResponse.json();
    
    if (repos.success) {
      console.log('✅ Repository management endpoint working');
      console.log(`   - Current repositories: ${repos.data.length > 0 ? repos.data.join(', ') : 'None'}`);
    } else {
      console.log('❌ Repository management endpoint failed');
    }

    // Test 4: Add a test repository (if none exist)
    if (repos.data.length === 0) {
      console.log('\n4️⃣  Adding test repository...');
      const addRepoResponse = await fetch(`${API_BASE}/monitoring/repositories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repository: 'anubissbe/GitHub-RunnerHub' })
      });
      
      const addResult = await addRepoResponse.json();
      if (addResult.success) {
        console.log('✅ Successfully added test repository');
      } else {
        console.log('❌ Failed to add test repository:', addResult.message);
      }
    }

    // Test 5: Check if GitHub data is being fetched
    console.log('\n5️⃣  Checking GitHub data integration...');
    if (dashboard.data.system.jobs.total > 0 || dashboard.data.githubIntegration.rateLimitStatus.used > 0) {
      console.log('✅ GitHub data is being fetched');
      console.log(`   - Total jobs (GitHub + Local): ${dashboard.data.system.jobs.total}`);
      console.log(`   - Running jobs: ${dashboard.data.system.jobs.running}`);
      console.log(`   - Total runners: ${dashboard.data.system.runners.total}`);
    } else {
      console.log('⚠️  No GitHub data found (this is normal if no workflows have run)');
    }

    console.log('\n✨ GitHub integration test completed!');
    console.log('\n📊 Open http://localhost:5173 to view the dashboard with live GitHub data');
    
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.log('\n🔧 Make sure the server is running:');
    console.log('   npm run dev');
  }
}

// Run the test
testGitHubIntegration();