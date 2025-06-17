import React from 'react';
import { GitBranch, Play, CheckCircle, XCircle, Clock, User, GitCommit } from 'lucide-react';
import { WorkflowRun, Job } from '../types';

interface WorkflowTrackerProps {
  workflows: WorkflowRun[];
  jobs: Job[];
}

const WorkflowTracker: React.FC<WorkflowTrackerProps> = ({ workflows, jobs }) => {
  const getWorkflowJobs = (workflowId: number) => {
    return jobs.filter(job => job.run_id === workflowId);
  };

  const getWorkflowStatus = (workflow: WorkflowRun) => {
    if (workflow.status === 'completed') {
      return workflow.conclusion === 'success' ? 'success' : 'failure';
    }
    return workflow.status;
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'success':
        return <CheckCircle className="w-5 h-5 text-green-500" />;
      case 'failure':
        return <XCircle className="w-5 h-5 text-red-500" />;
      case 'in_progress':
        return <Play className="w-5 h-5 text-primary-500" />;
      default:
        return <Clock className="w-5 h-5 text-yellow-500" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'success':
        return 'border-green-500/30 bg-green-500/5';
      case 'failure':
        return 'border-red-500/30 bg-red-500/5';
      case 'in_progress':
        return 'border-primary-500/30 bg-primary-500/5';
      default:
        return 'border-yellow-500/30 bg-yellow-500/5';
    }
  };

  const formatDuration = (startedAt: string, completedAt?: string | null) => {
    const start = new Date(startedAt);
    const end = completedAt ? new Date(completedAt) : new Date();
    const duration = Math.floor((end.getTime() - start.getTime()) / 60000);
    return `${duration}m`;
  };

  return (
    <div className="bg-gradient-to-br from-gray-800/90 to-gray-900/90 backdrop-blur-xl rounded-3xl p-6 border border-gray-700/50">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-white flex items-center">
          <div className="p-2 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl mr-3">
            <GitBranch className="w-6 h-6 text-white" />
          </div>
          Active Workflows
          <span className="ml-3 text-sm font-normal text-gray-400">({workflows.length} running)</span>
        </h2>
      </div>

      <div className="space-y-4">
        {workflows.slice(0, 10).map(workflow => {
          const workflowJobs = getWorkflowJobs(workflow.id);
          const status = getWorkflowStatus(workflow);
          
          return (
            <div
              key={workflow.id}
              className={`border rounded-lg p-4 ${getStatusColor(status)}`}
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-start space-x-3">
                  {getStatusIcon(status)}
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center space-x-2 mb-1">
                      <h3 className="font-medium text-white truncate">
                        {workflow.name}
                      </h3>
                      <span className="text-xs bg-gray-600 px-2 py-1 rounded">
                        #{workflow.run_number}
                      </span>
                    </div>
                    
                    <div className="text-sm text-gray-400 mb-2">
                      {workflow.repository.full_name}
                    </div>
                    
                    <div className="flex items-center space-x-4 text-xs text-gray-500">
                      <div className="flex items-center space-x-1">
                        <GitBranch className="w-3 h-3" />
                        <span>{workflow.head_branch}</span>
                      </div>
                      
                      <div className="flex items-center space-x-1">
                        <GitCommit className="w-3 h-3" />
                        <span>{workflow.head_sha.substring(0, 7)}</span>
                      </div>
                      
                      <div className="flex items-center space-x-1">
                        <User className="w-3 h-3" />
                        <span>{workflow.actor.login}</span>
                      </div>
                      
                      <div className="flex items-center space-x-1">
                        <Clock className="w-3 h-3" />
                        <span>{formatDuration(workflow.created_at, workflow.updated_at)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Jobs */}
              {workflowJobs.length > 0 && (
                <div className="border-t border-gray-600 pt-3">
                  <div className="text-xs text-gray-400 mb-2">
                    Jobs ({workflowJobs.length})
                  </div>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {workflowJobs.map(job => (
                      <div
                        key={job.id}
                        className="bg-gray-700 rounded p-2 text-xs"
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-medium text-gray-200 truncate">
                            {job.name}
                          </span>
                          {getStatusIcon(job.status)}
                        </div>
                        
                        <div className="text-gray-400 space-y-1">
                          {job.runner_name && (
                            <div>Runner: {job.runner_name}</div>
                          )}
                          
                          {job.started_at && (
                            <div>
                              Duration: {formatDuration(job.started_at, job.completed_at)}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {workflows.length === 0 && (
        <div className="text-center py-8 text-gray-400">
          <GitBranch className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p>No active workflows found.</p>
        </div>
      )}
    </div>
  );
};

export default WorkflowTracker;