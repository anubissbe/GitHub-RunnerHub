import React from 'react';
import { Server, TrendingUp } from 'lucide-react';
import { Runner, Job } from '../types';
import RunnerCard from './RunnerCard';

interface RunnerGridProps {
  runners: Runner[];
  jobs: Job[];
}

const RunnerGrid: React.FC<RunnerGridProps> = ({ runners, jobs }) => {
  const getRunnerJob = (runnerId: number) => {
    return jobs.find(job => job.runner_id === runnerId && job.status === 'in_progress');
  };

  const onlineRunners = runners.filter(r => r.status === 'online');
  const busyRunners = onlineRunners.filter(r => getRunnerJob(r.id));
  const utilizationRate = onlineRunners.length > 0 ? (busyRunners.length / onlineRunners.length * 100) : 0;

  return (
    <div className="space-y-6">
      {/* Header Card */}
      <div className="bg-gradient-to-r from-gray-800/90 to-gray-900/90 backdrop-blur-xl rounded-3xl p-6 border border-gray-700/50">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-white mb-2 flex items-center">
              <div className="p-2 bg-gradient-to-br from-orange-500 to-primary-600 rounded-xl mr-3">
                <Server className="w-6 h-6 text-white" />
              </div>
              GitHub Runners
            </h2>
            <p className="text-gray-400 text-sm">Real-time monitoring of self-hosted runners</p>
          </div>
          
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center p-4 bg-gray-900/50 rounded-xl border border-gray-700/50">
              <div className="text-2xl font-bold text-white mb-1">{runners.length}</div>
              <div className="text-xs text-gray-400">Total</div>
            </div>
            <div className="text-center p-4 bg-gray-900/50 rounded-xl border border-gray-700/50">
              <div className="text-2xl font-bold text-green-400 mb-1">{onlineRunners.length}</div>
              <div className="text-xs text-gray-400">Online</div>
            </div>
            <div className="text-center p-4 bg-gray-900/50 rounded-xl border border-gray-700/50">
              <div className="text-2xl font-bold text-orange-400 mb-1">{busyRunners.length}</div>
              <div className="text-xs text-gray-400">Active</div>
            </div>
          </div>
        </div>
        
        {/* Utilization Bar */}
        <div className="mt-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-gray-400 flex items-center">
              <TrendingUp className="w-4 h-4 mr-1" />
              Utilization Rate
            </span>
            <span className="text-sm font-semibold text-primary-400">{utilizationRate.toFixed(1)}%</span>
          </div>
          <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
            <div 
              className="h-full bg-gradient-to-r from-orange-500 to-primary-600 rounded-full transition-all duration-300"
              style={{ width: `${utilizationRate}%` }}
            ></div>
          </div>
        </div>
      </div>

      {/* Runners Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-5">
        {runners.map((runner, index) => {
          const job = getRunnerJob(runner.id);
          // Use a consistent numbering system based on array index
          const runnerNumber = (index + 1).toString().padStart(2, '0');

          return (
            <RunnerCard
              key={runner.id}
              runner={runner}
              job={job}
              runnerNumber={runnerNumber}
            />
          );
        })}
      </div>

      {runners.length === 0 && (
        <div className="bg-gray-800/50 backdrop-blur-xl rounded-3xl p-16 border border-gray-700/50 text-center">
          <div className="inline-flex p-6 bg-gray-900/50 rounded-full mb-6">
            <Server className="w-16 h-16 text-gray-600" />
          </div>
          <h3 className="text-xl font-semibold text-gray-300 mb-2">No Runners Found</h3>
          <p className="text-gray-500">Waiting for runner data to be available...</p>
        </div>
      )}
    </div>
  );
};

export default RunnerGrid;