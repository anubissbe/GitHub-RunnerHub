import React from 'react';
import {
  Paper,
  Typography,
  Grid,
  Box,
  Chip,
  LinearProgress
} from '@mui/material';
import {
  CheckCircle as CheckCircleIcon,
  Warning as WarningIcon,
  Error as ErrorIcon,
  Schedule as ScheduleIcon,
  Speed as SpeedIcon,
  Storage as StorageIcon
} from '@mui/icons-material';

const SystemOverviewWidget = ({ data }) => {
  if (!data) return null;

  const getStatusIcon = (status) => {
    switch (status) {
      case 'healthy':
        return <CheckCircleIcon color="success" />;
      case 'warning':
        return <WarningIcon color="warning" />;
      case 'critical':
        return <ErrorIcon color="error" />;
      default:
        return null;
    }
  };

  const formatUptime = (ms) => {
    const seconds = Math.floor(ms / 1000);
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    
    if (days > 0) {
      return `${days}d ${hours}h`;
    } else if (hours > 0) {
      return `${hours}h ${minutes}m`;
    } else {
      return `${minutes}m`;
    }
  };

  const metrics = [
    {
      label: 'Active Containers',
      value: data.activeContainers,
      icon: <StorageIcon />,
      color: '#2196f3'
    },
    {
      label: 'Queued Jobs',
      value: data.queuedJobs,
      icon: <ScheduleIcon />,
      color: '#ff9800'
    },
    {
      label: 'Completed Jobs',
      value: data.completedJobs,
      icon: <CheckCircleIcon />,
      color: '#4caf50'
    },
    {
      label: 'Failed Jobs',
      value: data.failedJobs,
      icon: <ErrorIcon />,
      color: '#f44336'
    }
  ];

  const successRate = data.totalJobs > 0 
    ? ((data.completedJobs / data.totalJobs) * 100).toFixed(1)
    : 0;

  return (
    <Paper sx={{ p: 3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h6">System Overview</Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {getStatusIcon(data.status)}
          <Chip 
            label={data.status.toUpperCase()} 
            color={data.status === 'healthy' ? 'success' : 'warning'}
            size="small"
          />
        </Box>
      </Box>

      <Grid container spacing={3}>
        {metrics.map((metric, index) => (
          <Grid item xs={12} sm={6} md={3} key={index}>
            <Box sx={{ 
              display: 'flex', 
              flexDirection: 'column', 
              alignItems: 'center',
              p: 2,
              border: '1px solid #e0e0e0',
              borderRadius: 2,
              bgcolor: 'background.paper'
            }}>
              <Box sx={{ color: metric.color, mb: 1 }}>
                {metric.icon}
              </Box>
              <Typography variant="h4" sx={{ fontWeight: 'bold', color: metric.color }}>
                {metric.value}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {metric.label}
              </Typography>
            </Box>
          </Grid>
        ))}
      </Grid>

      <Box sx={{ mt: 3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
          <Typography variant="body2">Success Rate</Typography>
          <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
            {successRate}%
          </Typography>
        </Box>
        <LinearProgress 
          variant="determinate" 
          value={parseFloat(successRate)} 
          sx={{ height: 8, borderRadius: 4 }}
        />
      </Box>

      <Box sx={{ mt: 2, display: 'flex', justifyContent: 'space-between' }}>
        <Typography variant="body2" color="text.secondary">
          System Uptime
        </Typography>
        <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
          {formatUptime(data.uptime)}
        </Typography>
      </Box>
    </Paper>
  );
};

export default SystemOverviewWidget;