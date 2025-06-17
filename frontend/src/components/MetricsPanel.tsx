import React from 'react';
import { Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { TrendingUp, Clock, Activity, Zap } from 'lucide-react';
import { Metrics } from '../types';

interface MetricsPanelProps {
  metrics: Metrics | null;
}

const MetricsPanel: React.FC<MetricsPanelProps> = ({ metrics }) => {
  if (!metrics) {
    return (
      <div className="bg-gray-800 rounded-lg p-6">
        <h3 className="text-lg font-semibold mb-4 flex items-center">
          <TrendingUp className="w-5 h-5 mr-2" />
          Metrics
        </h3>
        <div className="text-center py-8 text-gray-400">
          <div className="animate-pulse">Loading metrics...</div>
        </div>
      </div>
    );
  }

  const utilizationData = [
    { name: 'Busy', value: metrics.busy_runners, color: '#ff6500' },
    { name: 'Idle', value: metrics.online_runners - metrics.busy_runners, color: '#10b981' },
    { name: 'Offline', value: metrics.total_runners - metrics.online_runners, color: '#ef4444' },
  ];

  const performanceMetrics = [
    { name: 'Avg Job Duration', value: metrics.avg_job_duration_minutes, unit: 'min', icon: Clock, color: 'text-blue-400' },
    { name: 'Queue Time', value: metrics.queue_time_minutes, unit: 'min', icon: Clock, color: 'text-yellow-400' },
    { name: 'Utilization', value: metrics.utilization_percentage, unit: '%', icon: Activity, color: 'text-primary-400' },
    { name: 'Workflows Today', value: metrics.total_workflows_today, unit: '', icon: Zap, color: 'text-green-400' },
  ];

  return (
    <div className="bg-gray-800 rounded-lg p-6">
      <h3 className="text-lg font-semibold mb-6 flex items-center">
        <TrendingUp className="w-5 h-5 mr-2" />
        Metrics & Analytics
      </h3>

      {/* Key Metrics */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        {performanceMetrics.map((metric, index) => {
          const Icon = metric.icon;
          return (
            <div key={index} className="bg-gray-700 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <Icon className={`w-4 h-4 ${metric.color}`} />
                <span className={`text-lg font-bold ${metric.color}`}>
                  {metric.value}{metric.unit}
                </span>
              </div>
              <div className="text-xs text-gray-400">{metric.name}</div>
            </div>
          );
        })}
      </div>

      {/* Runner Utilization Chart */}
      <div className="mb-6">
        <h4 className="text-sm font-medium text-gray-300 mb-3">Runner Status Distribution</h4>
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={utilizationData}
                cx="50%"
                cy="50%"
                innerRadius={40}
                outerRadius={80}
                paddingAngle={5}
                dataKey="value"
              >
                {utilizationData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  backgroundColor: '#374151',
                  border: '1px solid #4b5563',
                  borderRadius: '8px',
                  color: '#f3f4f6'
                }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
        
        <div className="flex justify-center space-x-4 mt-3">
          {utilizationData.map((entry, index) => (
            <div key={index} className="flex items-center space-x-2">
              <div
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: entry.color }}
              ></div>
              <span className="text-xs text-gray-400">
                {entry.name} ({entry.value})
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Most Active Repository */}
      {metrics.most_active_repo && (
        <div className="bg-gray-700 rounded-lg p-4">
          <h4 className="text-sm font-medium text-gray-300 mb-2">Most Active Repository</h4>
          <div className="text-primary-400 font-medium">{metrics.most_active_repo}</div>
        </div>
      )}
    </div>
  );
};

export default MetricsPanel;