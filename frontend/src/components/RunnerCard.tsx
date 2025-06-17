import React from 'react';
import { Server, Play, Pause, Cpu, Clock, GitBranch, Zap } from 'lucide-react';
import { Runner, Job } from '../types';

interface RunnerCardProps {
  runner: Runner;
  job?: Job;
  runnerNumber: string | number;
}

const RunnerCard: React.FC<RunnerCardProps> = ({ runner, job, runnerNumber }) => {
  const getJobDuration = (job: Job) => {
    if (!job.started_at) return 0;
    const start = new Date(job.started_at);
    const now = new Date();
    return Math.floor((now.getTime() - start.getTime()) / 60000);
  };

  const getStatusGradient = () => {
    if (runner.status === 'offline') return 'from-red-600 to-red-700';
    if (job) return 'from-orange-500 to-primary-600';
    return 'from-green-500 to-emerald-600';
  };

  const getStatusPulse = () => {
    if (runner.status === 'offline') return '';
    if (job) return 'animate-pulse';
    return '';
  };

  const getStatusIcon = () => {
    if (job) return <Play className="w-5 h-5" />;
    if (runner.status === 'online') return <Pause className="w-5 h-5" />;
    return <Cpu className="w-5 h-5 opacity-50" />;
  };

  const getStatusText = () => {
    if (runner.status === 'offline') return 'Offline';
    if (job) return 'Running';
    return 'Ready';
  };

  const jobDuration = job ? getJobDuration(job) : 0;

  return (
    <div className="group relative">
      {/* Glow effect for busy runners */}
      {job && (
        <div className="absolute -inset-0.5 bg-gradient-to-r from-orange-500 to-primary-600 rounded-2xl blur opacity-30 group-hover:opacity-50 animate-pulse"></div>
      )}
      
      <div className="relative bg-gray-800/90 backdrop-blur-xl rounded-2xl border border-gray-700/50 hover:border-gray-600/50 transition-all duration-300 overflow-hidden">
        {/* Status bar */}
        <div className={`h-1 bg-gradient-to-r ${getStatusGradient()} ${getStatusPulse()}`}></div>
        
        <div className="p-5">
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center space-x-3">
              <div className={`relative p-2.5 rounded-xl bg-gradient-to-br ${getStatusGradient()} shadow-lg`}>
                <Server className="w-5 h-5 text-white" />
                {job && (
                  <div className="absolute -top-1 -right-1 w-3 h-3 bg-orange-400 rounded-full animate-ping"></div>
                )}
              </div>
              <div>
                <h3 className="font-semibold text-white text-lg">Runner #{runnerNumber}</h3>
                <p className="text-xs text-gray-400 flex items-center gap-1">
                  {getStatusIcon()}
                  <span className={
                    runner.status === 'offline' ? 'text-red-400' :
                    job ? 'text-orange-400' : 'text-green-400'
                  }>{getStatusText()}</span>
                </p>
              </div>
            </div>
          </div>

          {/* Job info */}
          {job ? (
            <div className="space-y-3 mb-3">
              <div className="bg-gray-900/50 rounded-xl p-3 border border-gray-700/30">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center space-x-2 text-orange-400">
                    <GitBranch className="w-4 h-4" />
                    <span className="text-xs font-medium">Active Job</span>
                  </div>
                  <div className="flex items-center text-xs text-gray-400">
                    <Clock className="w-3 h-3 mr-1" />
                    {jobDuration}m
                  </div>
                </div>
                <p className="text-sm text-gray-200 font-medium truncate">{job.name}</p>
                
                {/* Progress indicator */}
                <div className="mt-2 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-orange-500 to-primary-600 rounded-full animate-pulse" 
                       style={{ width: '60%' }}></div>
                </div>
              </div>
            </div>
          ) : (
            <div className="h-20 flex items-center justify-center">
              <div className="text-center">
                <Zap className="w-8 h-8 text-gray-600 mx-auto mb-1" />
                <p className="text-xs text-gray-500">Waiting for jobs</p>
              </div>
            </div>
          )}

          {/* Footer */}
          <div className="flex items-center justify-between text-xs">
            <span className="text-gray-500 flex items-center gap-1">
              <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
              {runner.os}
            </span>
            <span className="text-gray-600">v2.301.1</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RunnerCard;