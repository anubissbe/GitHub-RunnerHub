export interface Runner {
  id: number;
  name: string;
  status: 'online' | 'offline';
  busy: boolean;
  labels: string[];
  os: string;
}

export interface WorkflowRun {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  created_at: string;
  updated_at: string;
  repository: {
    name: string;
    full_name: string;
  };
  head_branch: string;
  head_sha: string;
  actor: {
    login: string;
    avatar_url: string;
  };
  run_number: number;
  jobs_url: string;
}

export interface Job {
  id: number;
  run_id: number;
  name: string;
  status: string;
  conclusion: string | null;
  started_at: string | null;
  completed_at: string | null;
  runner_id: number | null;
  runner_name: string | null;
  steps: JobStep[];
}

export interface JobStep {
  name: string;
  status: string;
  conclusion: string | null;
  number: number;
  started_at: string | null;
  completed_at: string | null;
}

export interface Metrics {
  total_runners: number;
  online_runners: number;
  busy_runners: number;
  total_workflows_today: number;
  avg_job_duration_minutes: number;
  queue_time_minutes: number;
  utilization_percentage: number;
  most_active_repo: string;
}

export interface Alert {
  id: string;
  type: 'runner_offline' | 'runner_online' | 'long_running_job' | 'high_queue_time';
  message: string;
  severity: 'info' | 'warning' | 'error';
  timestamp: string;
  data?: any;
}

export interface WebSocketMessage {
  type: 'runners' | 'workflows' | 'jobs' | 'metrics' | 'alert';
  data: any;
}