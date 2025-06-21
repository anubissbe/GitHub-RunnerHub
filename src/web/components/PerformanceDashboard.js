/**
 * Performance Dashboard Component
 * React component for displaying performance analytics
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  Grid,
  Paper,
  Typography,
  Box,
  Card,
  CardContent,
  LinearProgress,
  Chip,
  IconButton,
  Button,
  Menu,
  MenuItem,
  Tooltip,
  Alert,
  AlertTitle,
  Divider,
  Tab,
  Tabs
} from '@mui/material';
import {
  Refresh as RefreshIcon,
  Download as DownloadIcon,
  Settings as SettingsIcon,
  Warning as WarningIcon,
  CheckCircle as CheckCircleIcon,
  Error as ErrorIcon,
  TrendingUp as TrendingUpIcon,
  TrendingDown as TrendingDownIcon,
  Speed as SpeedIcon,
  Memory as MemoryIcon,
  Storage as StorageIcon,
  NetworkCheck as NetworkIcon
} from '@mui/icons-material';
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as ChartTooltip,
  Legend,
  ResponsiveContainer
} from 'recharts';
import { format } from 'date-fns';

// Widget Components
import SystemOverviewWidget from './widgets/SystemOverviewWidget';
import ResourceUtilizationWidget from './widgets/ResourceUtilizationWidget';
import JobPerformanceWidget from './widgets/JobPerformanceWidget';
import CachePerformanceWidget from './widgets/CachePerformanceWidget';
import BottleneckAnalysisWidget from './widgets/BottleneckAnalysisWidget';
import PredictiveInsightsWidget from './widgets/PredictiveInsightsWidget';
import CostAnalysisWidget from './widgets/CostAnalysisWidget';
import AlertsWidget from './widgets/AlertsWidget';

const REFRESH_INTERVAL = 5000; // 5 seconds

const PerformanceDashboard = () => {
  const [dashboardData, setDashboardData] = useState(null);
  const [selectedTab, setSelectedTab] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [anchorEl, setAnchorEl] = useState(null);
  const eventSourceRef = useRef(null);

  // Fetch dashboard data
  const fetchDashboardData = async () => {
    try {
      const response = await fetch('/api/analytics/dashboard');
      const data = await response.json();
      
      if (data.success) {
        setDashboardData(data.data);
        setError(null);
      } else {
        throw new Error(data.error || 'Failed to fetch dashboard data');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Set up real-time updates
  const setupRealTimeUpdates = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const eventSource = new EventSource('/api/analytics/realtime');
    
    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      if (data.type === 'dashboard_update') {
        setDashboardData(data.data);
      } else if (data.type === 'alert') {
        // Handle new alerts
        console.log('New alert:', data.alert);
      }
    };

    eventSource.onerror = (err) => {
      console.error('EventSource error:', err);
      eventSource.close();
    };

    eventSourceRef.current = eventSource;
  };

  useEffect(() => {
    fetchDashboardData();
    setupRealTimeUpdates();

    // Auto-refresh timer
    const interval = autoRefresh ? setInterval(fetchDashboardData, REFRESH_INTERVAL) : null;

    return () => {
      if (interval) clearInterval(interval);
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, [autoRefresh]);

  const handleTabChange = (event, newValue) => {
    setSelectedTab(newValue);
  };

  const handleExport = async (format) => {
    try {
      const response = await fetch(`/api/analytics/export?format=${format}`);
      const blob = await response.blob();
      
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `performance-report.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export failed:', err);
    }
  };

  const getSystemHealthIcon = (status) => {
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

  if (loading) {
    return (
      <Box sx={{ width: '100%', mt: 2 }}>
        <LinearProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Alert severity="error" sx={{ mt: 2 }}>
        <AlertTitle>Error</AlertTitle>
        {error}
      </Alert>
    );
  }

  return (
    <Box sx={{ flexGrow: 1, p: 2 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Typography variant="h4" component="h1">
            Performance Analytics
          </Typography>
          {dashboardData && getSystemHealthIcon(dashboardData.overview.status)}
        </Box>
        
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Tooltip title={autoRefresh ? "Disable auto-refresh" : "Enable auto-refresh"}>
            <IconButton 
              onClick={() => setAutoRefresh(!autoRefresh)}
              color={autoRefresh ? "primary" : "default"}
            >
              <RefreshIcon />
            </IconButton>
          </Tooltip>
          
          <Button
            startIcon={<DownloadIcon />}
            onClick={(e) => setAnchorEl(e.currentTarget)}
          >
            Export
          </Button>
          
          <Menu
            anchorEl={anchorEl}
            open={Boolean(anchorEl)}
            onClose={() => setAnchorEl(null)}
          >
            <MenuItem onClick={() => { handleExport('json'); setAnchorEl(null); }}>
              Export as JSON
            </MenuItem>
            <MenuItem onClick={() => { handleExport('csv'); setAnchorEl(null); }}>
              Export as CSV
            </MenuItem>
            <MenuItem onClick={() => { handleExport('pdf'); setAnchorEl(null); }}>
              Export as PDF
            </MenuItem>
          </Menu>
          
          <IconButton>
            <SettingsIcon />
          </IconButton>
        </Box>
      </Box>

      {/* Tabs */}
      <Paper sx={{ mb: 3 }}>
        <Tabs value={selectedTab} onChange={handleTabChange}>
          <Tab label="Overview" />
          <Tab label="Performance" />
          <Tab label="Resources" />
          <Tab label="Analytics" />
          <Tab label="Alerts" />
        </Tabs>
      </Paper>

      {/* Tab Content */}
      {selectedTab === 0 && (
        <Grid container spacing={3}>
          <Grid item xs={12}>
            <SystemOverviewWidget data={dashboardData?.overview} />
          </Grid>
          
          <Grid item xs={12} lg={6}>
            <ResourceUtilizationWidget data={dashboardData?.resources} />
          </Grid>
          
          <Grid item xs={12} lg={6}>
            <JobPerformanceWidget data={dashboardData?.jobs} />
          </Grid>
          
          <Grid item xs={12}>
            <Paper sx={{ p: 2 }}>
              <Typography variant="h6" gutterBottom>
                System Activity Timeline
              </Typography>
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={dashboardData?.performance?.timeSeries?.job_throughput || []}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis 
                    dataKey="timestamp" 
                    tickFormatter={(ts) => format(new Date(ts), 'HH:mm')}
                  />
                  <YAxis />
                  <ChartTooltip 
                    labelFormatter={(ts) => format(new Date(ts), 'PPpp')}
                  />
                  <Area 
                    type="monotone" 
                    dataKey="value" 
                    stroke="#8884d8" 
                    fill="#8884d8" 
                    fillOpacity={0.6}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </Paper>
          </Grid>
        </Grid>
      )}

      {selectedTab === 1 && (
        <Grid container spacing={3}>
          <Grid item xs={12}>
            <CachePerformanceWidget data={dashboardData?.cache} />
          </Grid>
          
          <Grid item xs={12} lg={6}>
            <Paper sx={{ p: 2 }}>
              <Typography variant="h6" gutterBottom>
                Response Time Distribution
              </Typography>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={dashboardData?.performance?.timeSeries?.response_time || []}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis 
                    dataKey="timestamp" 
                    tickFormatter={(ts) => format(new Date(ts), 'HH:mm')}
                  />
                  <YAxis />
                  <ChartTooltip 
                    labelFormatter={(ts) => format(new Date(ts), 'PPpp')}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="value" 
                    stroke="#82ca9d"
                    strokeWidth={2}
                  />
                </LineChart>
              </ResponsiveContainer>
            </Paper>
          </Grid>
          
          <Grid item xs={12} lg={6}>
            <BottleneckAnalysisWidget data={dashboardData?.bottlenecks} />
          </Grid>
        </Grid>
      )}

      {selectedTab === 2 && (
        <Grid container spacing={3}>
          <Grid item xs={12} lg={6}>
            <Paper sx={{ p: 2 }}>
              <Typography variant="h6" gutterBottom>
                CPU Utilization
              </Typography>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={dashboardData?.performance?.timeSeries?.cpu_utilization || []}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis 
                    dataKey="timestamp" 
                    tickFormatter={(ts) => format(new Date(ts), 'HH:mm')}
                  />
                  <YAxis domain={[0, 100]} />
                  <ChartTooltip 
                    labelFormatter={(ts) => format(new Date(ts), 'PPpp')}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="value" 
                    stroke="#ff7300"
                    strokeWidth={2}
                  />
                </LineChart>
              </ResponsiveContainer>
            </Paper>
          </Grid>
          
          <Grid item xs={12} lg={6}>
            <Paper sx={{ p: 2 }}>
              <Typography variant="h6" gutterBottom>
                Memory Utilization
              </Typography>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={dashboardData?.performance?.timeSeries?.memory_utilization || []}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis 
                    dataKey="timestamp" 
                    tickFormatter={(ts) => format(new Date(ts), 'HH:mm')}
                  />
                  <YAxis domain={[0, 100]} />
                  <ChartTooltip 
                    labelFormatter={(ts) => format(new Date(ts), 'PPpp')}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="value" 
                    stroke="#0088fe"
                    strokeWidth={2}
                  />
                </LineChart>
              </ResponsiveContainer>
            </Paper>
          </Grid>
          
          <Grid item xs={12}>
            <CostAnalysisWidget data={dashboardData?.cost} />
          </Grid>
        </Grid>
      )}

      {selectedTab === 3 && (
        <Grid container spacing={3}>
          <Grid item xs={12}>
            <PredictiveInsightsWidget data={dashboardData?.predictions} />
          </Grid>
          
          <Grid item xs={12}>
            <Paper sx={{ p: 2 }}>
              <Typography variant="h6" gutterBottom>
                Performance Trends
              </Typography>
              <ResponsiveContainer width="100%" height={400}>
                <LineChart>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="timestamp" />
                  <YAxis yAxisId="left" />
                  <YAxis yAxisId="right" orientation="right" />
                  <ChartTooltip />
                  <Legend />
                  <Line 
                    yAxisId="left"
                    type="monotone" 
                    dataKey="throughput" 
                    stroke="#8884d8" 
                    name="Throughput"
                  />
                  <Line 
                    yAxisId="right"
                    type="monotone" 
                    dataKey="responseTime" 
                    stroke="#82ca9d" 
                    name="Response Time"
                  />
                </LineChart>
              </ResponsiveContainer>
            </Paper>
          </Grid>
        </Grid>
      )}

      {selectedTab === 4 && (
        <Grid container spacing={3}>
          <Grid item xs={12}>
            <AlertsWidget alerts={dashboardData?.alerts || []} />
          </Grid>
        </Grid>
      )}
    </Box>
  );
};

export default PerformanceDashboard;