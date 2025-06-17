import { useEffect, useState } from 'react';
import { Activity, Clock, GitBranch, Monitor, Server, AlertTriangle } from 'lucide-react';
import RunnerGrid from './components/RunnerGrid';
import WorkflowTracker from './components/WorkflowTracker';
import MetricsPanel from './components/MetricsPanel';
import AlertsPanel from './components/AlertsPanel';
import { useWebSocket } from './hooks/useWebSocket';
import { Runner, WorkflowRun, Job, Metrics } from './types';

const API_BASE = 'http://192.168.1.25:8300';

function App() {
  const [runners, setRunners] = useState<Runner[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowRun[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());

  const { isConnected, error } = useWebSocket(`ws://192.168.1.25:8300/ws`, {
    onMessage: (data) => {
      console.log('WebSocket message:', data);
      if (data.type === 'runners') {
        setRunners(data.data);
      } else if (data.type === 'workflows') {
        setWorkflows(data.data);
      } else if (data.type === 'jobs') {
        setJobs(data.data);
      } else if (data.type === 'metrics') {
        setMetrics(data.data);
      } else if (data.type === 'alert') {
        setAlerts(prev => [data.data, ...prev.slice(0, 9)]);
      }
      setLastUpdate(new Date());
    }
  });

  const fetchData = async () => {
    try {
      const [runnersRes, workflowsRes, jobsRes] = await Promise.all([
        fetch(`${API_BASE}/api/runners`),
        fetch(`${API_BASE}/api/workflows/active`),
        fetch(`${API_BASE}/api/jobs/active`)
      ]);

      if (runnersRes.ok) setRunners(await runnersRes.json());
      if (workflowsRes.ok) setWorkflows(await workflowsRes.json());
      if (jobsRes.ok) setJobs(await jobsRes.json());
      
      setLastUpdate(new Date());
    } catch (error) {
      console.error('Failed to fetch data:', error);
    }
  };

  useEffect(() => {
    fetchData().finally(() => setLoading(false));
    
    // Refresh data every 10 seconds
    const interval = setInterval(fetchData, 10000);
    
    return () => clearInterval(interval);
  }, []);

  const activeRunners = runners.filter(r => r.status === 'online').length;
  const busyRunners = jobs.filter(j => j.status === 'in_progress').length;

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-900 to-gray-800 flex items-center justify-center">
        <div className="text-center">
          <div className="relative">
            <div className="absolute inset-0 bg-gradient-to-r from-orange-500 to-primary-600 rounded-full blur-2xl opacity-50"></div>
            <div className="relative">
              <div className="w-16 h-16 border-4 border-orange-500/30 border-t-orange-500 rounded-full animate-spin mx-auto mb-6"></div>
            </div>
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">GitHub Runners Monitor</h2>
          <p className="text-gray-400">Initializing real-time dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-900 to-gray-800 text-white">
      {/* Animated background gradient */}
      <div className="fixed inset-0 bg-gradient-to-br from-orange-500/5 via-transparent to-blue-500/5 pointer-events-none"></div>
      
      {/* Header */}
      <header className="relative bg-gray-900/50 backdrop-blur-xl border-b border-gray-800/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <div className="relative">
                <div className="absolute -inset-1 bg-gradient-to-r from-orange-500 to-primary-600 rounded-xl blur opacity-75"></div>
                <div className="relative bg-gradient-to-br from-orange-500 to-primary-600 p-3 rounded-xl shadow-2xl">
                  <Monitor className="w-8 h-8 text-white" />
                </div>
              </div>
              <div>
                <h1 className="text-2xl font-bold bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent">
                  GitHub Runners Monitor
                </h1>
                <p className="text-sm text-gray-400 mt-1">Real-time infrastructure monitoring dashboard</p>
              </div>
            </div>
            
            <div className="flex items-center space-x-6">
              <div className="bg-gray-800/50 backdrop-blur-xl rounded-xl px-4 py-2 border border-gray-700/50">
                <div className="flex items-center space-x-2">
                  <div className={`relative ${isConnected ? 'text-green-400' : 'text-red-400'}`}>
                    <div className={`absolute inset-0 rounded-full ${isConnected ? 'bg-green-400' : 'bg-red-400'} blur-md opacity-75`}></div>
                    <div className={`relative w-3 h-3 rounded-full ${isConnected ? 'bg-green-400' : 'bg-red-400'}`}></div>
                  </div>
                  <span className="text-sm font-medium text-gray-300">
                    {isConnected ? 'Live' : 'Offline'}
                  </span>
                </div>
              </div>
              
              <div className="bg-gray-800/50 backdrop-blur-xl rounded-xl px-4 py-2 border border-gray-700/50">
                <div className="text-sm text-gray-300 flex items-center">
                  <Clock className="w-4 h-4 mr-2 text-primary-400" />
                  <span className="font-mono">{lastUpdate.toLocaleTimeString()}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Stats Bar */}
      <div className="relative bg-gray-900/30 backdrop-blur-xl border-b border-gray-800/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-gray-800/50 backdrop-blur-xl rounded-xl p-4 border border-gray-700/50 hover:border-gray-600/50 transition-all">
              <div className="flex items-center justify-between">
                <div className="p-2 bg-green-500/20 rounded-lg">
                  <Server className="w-5 h-5 text-green-400" />
                </div>
                <div className="text-right">
                  <div className="text-2xl font-bold text-green-400">{activeRunners}</div>
                  <div className="text-xs text-gray-400">of {runners.length} online</div>
                </div>
              </div>
            </div>
            
            <div className="bg-gray-800/50 backdrop-blur-xl rounded-xl p-4 border border-gray-700/50 hover:border-gray-600/50 transition-all">
              <div className="flex items-center justify-between">
                <div className="p-2 bg-orange-500/20 rounded-lg">
                  <Activity className="w-5 h-5 text-orange-400" />
                </div>
                <div className="text-right">
                  <div className="text-2xl font-bold text-orange-400">{busyRunners}</div>
                  <div className="text-xs text-gray-400">active jobs</div>
                </div>
              </div>
            </div>
            
            <div className="bg-gray-800/50 backdrop-blur-xl rounded-xl p-4 border border-gray-700/50 hover:border-gray-600/50 transition-all">
              <div className="flex items-center justify-between">
                <div className="p-2 bg-blue-500/20 rounded-lg">
                  <GitBranch className="w-5 h-5 text-blue-400" />
                </div>
                <div className="text-right">
                  <div className="text-2xl font-bold text-blue-400">{workflows.length}</div>
                  <div className="text-xs text-gray-400">workflows</div>
                </div>
              </div>
            </div>
            
            <div className="bg-gray-800/50 backdrop-blur-xl rounded-xl p-4 border border-gray-700/50 hover:border-gray-600/50 transition-all">
              <div className="flex items-center justify-between">
                <div className="p-2 bg-yellow-500/20 rounded-lg">
                  <AlertTriangle className="w-5 h-5 text-yellow-400" />
                </div>
                <div className="text-right">
                  <div className="text-2xl font-bold text-yellow-400">{alerts.length}</div>
                  <div className="text-xs text-gray-400">alerts</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <main className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="space-y-8">
          {/* Runners Section */}
          <RunnerGrid runners={runners} jobs={jobs} />
          
          {/* Bottom Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Workflows - Takes 2 columns on large screens */}
            <div className="lg:col-span-2">
              <WorkflowTracker workflows={workflows} jobs={jobs} />
            </div>
            
            {/* Metrics & Alerts - Takes 1 column */}
            <div className="space-y-8">
              <MetricsPanel metrics={metrics} />
              <AlertsPanel alerts={alerts} />
            </div>
          </div>
        </div>
      </main>

      {/* Error Display */}
      {error && (
        <div className="fixed bottom-4 right-4 bg-red-600 text-white px-4 py-2 rounded-lg shadow-lg">
          <div className="flex items-center space-x-2">
            <AlertTriangle className="w-4 h-4" />
            <span className="text-sm">WebSocket Error: {error}</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;