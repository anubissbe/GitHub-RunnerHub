// Mock API responses
window.MOCK_API = {
  runners: Array.from({ length: 40 }, (_, i) => ({
    id: i + 1,
    name: `github-runner-${i + 1}`,
    os: 'Linux',
    status: i >= 36 ? 'offline' : 'online', // runners 37-40 are offline
    labels: ['self-hosted', 'Linux', 'X64'],
  })),
  
  workflows: [
    {
      id: 1,
      name: 'CI/CD Pipeline',
      run_number: 123,
      status: 'in_progress',
      conclusion: null,
      head_branch: 'main',
      head_sha: 'abc123def456',
      created_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      updated_at: new Date().toISOString(),
      repository: { full_name: 'anubissbe/ProjectHub-Mcp' },
      actor: { login: 'anubissbe' }
    },
    {
      id: 2,
      name: 'Test Suite',
      run_number: 456,
      status: 'in_progress',
      conclusion: null,
      head_branch: 'feature/new-api',
      head_sha: 'def789ghi012',
      created_at: new Date(Date.now() - 8 * 60 * 1000).toISOString(),
      updated_at: new Date().toISOString(),
      repository: { full_name: 'anubissbe/ProjectHub-Mcp' },
      actor: { login: 'anubissbe' }
    },
    {
      id: 3,
      name: 'Deploy Production',
      run_number: 789,
      status: 'in_progress',
      conclusion: null,
      head_branch: 'main',
      head_sha: 'ghi345jkl678',
      created_at: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
      updated_at: new Date().toISOString(),
      repository: { full_name: 'anubissbe/github-runners-monitor' },
      actor: { login: 'anubissbe' }
    },
    {
      id: 4,
      name: 'Security Audit',
      run_number: 101,
      status: 'in_progress',
      conclusion: null,
      head_branch: 'main',
      head_sha: 'jkl901mno234',
      created_at: new Date(Date.now() - 11 * 60 * 1000).toISOString(),
      updated_at: new Date().toISOString(),
      repository: { full_name: 'anubissbe/ProjectHub-Mcp' },
      actor: { login: 'anubissbe' }
    }
  ],
  
  jobs: [
    {
      id: 1,
      run_id: 1,
      name: 'Build Backend',
      status: 'in_progress',
      runner_id: 5,
      runner_name: 'github-runner-5',
      started_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      completed_at: null
    },
    {
      id: 2,
      run_id: 1,
      name: 'Build Frontend',
      status: 'in_progress',
      runner_id: 12,
      runner_name: 'github-runner-12',
      started_at: new Date(Date.now() - 3 * 60 * 1000).toISOString(),
      completed_at: null
    },
    {
      id: 3,
      run_id: 2,
      name: 'Run Tests',
      status: 'in_progress',
      runner_id: 18,
      runner_name: 'github-runner-18',
      started_at: new Date(Date.now() - 8 * 60 * 1000).toISOString(),
      completed_at: null
    },
    {
      id: 4,
      run_id: 3,
      name: 'Deploy to Production',
      status: 'in_progress',
      runner_id: 23,
      runner_name: 'github-runner-23',
      started_at: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
      completed_at: null
    },
    {
      id: 5,
      run_id: 4,
      name: 'Security Scan',
      status: 'in_progress',
      runner_id: 31,
      runner_name: 'github-runner-31',
      started_at: new Date(Date.now() - 11 * 60 * 1000).toISOString(),
      completed_at: null
    }
  ],
  
  metrics: {
    total_runners: 40,
    online_runners: 36,
    busy_runners: 5,
    avg_job_duration_minutes: 12.5,
    queue_time_minutes: 2.3,
    utilization_percentage: 13.9, // 5/36 = 13.9%
    total_workflows_today: 47,
    success_rate: 98.5,
    most_active_repo: 'anubissbe/ProjectHub-Mcp'
  },
  
  alerts: []
};