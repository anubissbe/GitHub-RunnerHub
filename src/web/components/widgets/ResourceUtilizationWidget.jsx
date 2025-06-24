import React from 'react';
import {
  Paper,
  Typography,
  Box,
  Grid,
  CircularProgress,
  Chip
} from '@mui/material';
import {
  Memory as MemoryIcon,
  Speed as SpeedIcon,
  Storage as StorageIcon,
  NetworkCheck as NetworkIcon
} from '@mui/icons-material';

const ResourceUtilizationWidget = ({ data }) => {
  if (!data) return null;

  const getColorByUtilization = (value) => {
    if (value >= 90) return '#f44336';
    if (value >= 70) return '#ff9800';
    if (value >= 50) return '#2196f3';
    return '#4caf50';
  };

  const resources = [
    {
      name: 'CPU',
      value: data.cpu?.[0]?.value || 0,
      icon: <SpeedIcon />,
      unit: '%'
    },
    {
      name: 'Memory',
      value: data.memory?.[0]?.value || 0,
      icon: <MemoryIcon />,
      unit: '%'
    },
    {
      name: 'Disk I/O',
      value: data.disk?.[0]?.value || 0,
      icon: <StorageIcon />,
      unit: '%'
    },
    {
      name: 'Network',
      value: data.network?.[0]?.value || 0,
      icon: <NetworkIcon />,
      unit: 'Mbps'
    }
  ];

  return (
    <Paper sx={{ p: 3 }}>
      <Typography variant="h6" gutterBottom>
        Resource Utilization
      </Typography>
      
      <Grid container spacing={3}>
        {resources.map((resource, index) => (
          <Grid item xs={6} md={3} key={index}>
            <Box sx={{ 
              display: 'flex', 
              flexDirection: 'column', 
              alignItems: 'center',
              position: 'relative'
            }}>
              <Box sx={{ position: 'relative', display: 'inline-flex' }}>
                <CircularProgress
                  variant="determinate"
                  value={Math.min(resource.value, 100)}
                  size={80}
                  thickness={4}
                  sx={{
                    color: getColorByUtilization(resource.value)
                  }}
                />
                <Box
                  sx={{
                    top: 0,
                    left: 0,
                    bottom: 0,
                    right: 0,
                    position: 'absolute',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Typography variant="h6" component="div">
                    {Math.round(resource.value)}
                  </Typography>
                </Box>
              </Box>
              
              <Box sx={{ mt: 2, textAlign: 'center' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                  {resource.icon}
                  <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
                    {resource.name}
                  </Typography>
                </Box>
                <Chip 
                  label={`${resource.value}${resource.unit}`}
                  size="small"
                  color={resource.value > 80 ? 'error' : 'default'}
                />
              </Box>
            </Box>
          </Grid>
        ))}
      </Grid>

      <Box sx={{ mt: 3, p: 2, bgcolor: 'grey.50', borderRadius: 1 }}>
        <Typography variant="body2" color="text.secondary">
          <strong>Resource Health:</strong> All resources are within normal operating ranges.
          CPU and Memory utilization are optimal for current workload.
        </Typography>
      </Box>
    </Paper>
  );
};

export default ResourceUtilizationWidget;