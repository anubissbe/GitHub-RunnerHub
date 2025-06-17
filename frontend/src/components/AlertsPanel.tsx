import React from 'react';
import { AlertTriangle, Info, XCircle, CheckCircle, Clock } from 'lucide-react';
import { Alert } from '../types';

interface AlertsPanelProps {
  alerts: Alert[];
}

const AlertsPanel: React.FC<AlertsPanelProps> = ({ alerts }) => {
  const getAlertIcon = (severity: string) => {
    switch (severity) {
      case 'error':
        return <XCircle className="w-4 h-4 text-red-500" />;
      case 'warning':
        return <AlertTriangle className="w-4 h-4 text-yellow-500" />;
      case 'info':
        return <Info className="w-4 h-4 text-blue-500" />;
      default:
        return <CheckCircle className="w-4 h-4 text-green-500" />;
    }
  };

  const getAlertBorderColor = (severity: string) => {
    switch (severity) {
      case 'error':
        return 'border-red-500/30 bg-red-500/5';
      case 'warning':
        return 'border-yellow-500/30 bg-yellow-500/5';
      case 'info':
        return 'border-blue-500/30 bg-blue-500/5';
      default:
        return 'border-green-500/30 bg-green-500/5';
    }
  };

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
    return date.toLocaleDateString();
  };

  const getAlertTypeText = (type: string) => {
    switch (type) {
      case 'runner_offline':
        return 'Runner Offline';
      case 'runner_online':
        return 'Runner Online';
      case 'long_running_job':
        return 'Long Running Job';
      case 'high_queue_time':
        return 'High Queue Time';
      default:
        return 'Unknown';
    }
  };

  return (
    <div className="bg-gray-800 rounded-lg p-6">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold flex items-center">
          <AlertTriangle className="w-5 h-5 mr-2" />
          Recent Alerts ({alerts.length})
        </h3>
      </div>

      <div className="space-y-3 max-h-96 overflow-y-auto">
        {alerts.length > 0 ? (
          alerts.map((alert, index) => (
            <div
              key={alert.id || index}
              className={`border rounded-lg p-3 ${getAlertBorderColor(alert.severity)}`}
            >
              <div className="flex items-start space-x-3">
                {getAlertIcon(alert.severity)}
                
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <div className="text-sm font-medium text-white">
                      {getAlertTypeText(alert.type)}
                    </div>
                    <div className="flex items-center text-xs text-gray-400">
                      <Clock className="w-3 h-3 mr-1" />
                      {formatTimestamp(alert.timestamp)}
                    </div>
                  </div>
                  
                  <div className="text-sm text-gray-300 mb-2">
                    {alert.message}
                  </div>
                  
                  {alert.data && (
                    <div className="text-xs text-gray-400 bg-gray-700 rounded p-2">
                      {Object.entries(alert.data).map(([key, value]) => (
                        <div key={key} className="flex justify-between">
                          <span className="capitalize">{key.replace('_', ' ')}:</span>
                          <span>{String(value)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))
        ) : (
          <div className="text-center py-8 text-gray-400">
            <CheckCircle className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p>No recent alerts</p>
            <p className="text-sm">All systems are running normally</p>
          </div>
        )}
      </div>

      {/* Alert Summary */}
      {alerts.length > 0 && (
        <div className="border-t border-gray-700 pt-4 mt-4">
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <div className="text-lg font-bold text-red-400">
                {alerts.filter(a => a.severity === 'error').length}
              </div>
              <div className="text-xs text-gray-400">Errors</div>
            </div>
            <div>
              <div className="text-lg font-bold text-yellow-400">
                {alerts.filter(a => a.severity === 'warning').length}
              </div>
              <div className="text-xs text-gray-400">Warnings</div>
            </div>
            <div>
              <div className="text-lg font-bold text-blue-400">
                {alerts.filter(a => a.severity === 'info').length}
              </div>
              <div className="text-xs text-gray-400">Info</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AlertsPanel;