/**
 * Performance Analytics API
 * REST API endpoints for performance analytics and dashboard data
 */

const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const PerformanceDashboard = require('../container-orchestration/performance/performance-dashboard');

// Initialize performance dashboard
let performanceDashboard = null;

/**
 * Initialize performance analytics
 */
function initializePerformanceAnalytics(performanceOptimizer) {
  performanceDashboard = new PerformanceDashboard(performanceOptimizer);
  performanceDashboard.start().catch(err => {
    logger.error('Failed to start performance dashboard:', err);
  });
}

/**
 * Middleware to ensure dashboard is initialized
 */
function ensureDashboard(req, res, next) {
  if (!performanceDashboard || !performanceDashboard.isRunning) {
    return res.status(503).json({
      error: 'Performance dashboard not initialized',
      message: 'The performance analytics system is starting up. Please try again later.'
    });
  }
  next();
}

/**
 * GET /api/analytics/dashboard
 * Get complete dashboard data
 */
router.get('/dashboard', ensureDashboard, (req, res) => {
  try {
    const dashboardData = performanceDashboard.getDashboardData();
    res.json({
      success: true,
      timestamp: Date.now(),
      data: dashboardData
    });
  } catch (error) {
    logger.error('Failed to get dashboard data:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve dashboard data'
    });
  }
});

/**
 * GET /api/analytics/widgets/:widgetName
 * Get specific widget data
 */
router.get('/widgets/:widgetName', ensureDashboard, (req, res) => {
  try {
    const { widgetName } = req.params;
    const widgetData = performanceDashboard.getWidgetData(widgetName);
    
    if (!widgetData) {
      return res.status(404).json({
        success: false,
        error: `Widget '${widgetName}' not found`
      });
    }
    
    res.json({
      success: true,
      timestamp: Date.now(),
      widget: widgetName,
      data: widgetData
    });
  } catch (error) {
    logger.error(`Failed to get widget data for ${req.params.widgetName}:`, error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve widget data'
    });
  }
});

/**
 * GET /api/analytics/metrics/:metricName
 * Get specific metric time series data
 */
router.get('/metrics/:metricName', ensureDashboard, (req, res) => {
  try {
    const { metricName } = req.params;
    const { start, end, interval } = req.query;
    
    const dashboardData = performanceDashboard.getDashboardData();
    const timeSeries = dashboardData.performance.timeSeries[metricName];
    
    if (!timeSeries) {
      return res.status(404).json({
        success: false,
        error: `Metric '${metricName}' not found`
      });
    }
    
    // Apply time filtering if provided
    let filteredData = timeSeries;
    if (start || end) {
      const startTime = start ? new Date(start).getTime() : 0;
      const endTime = end ? new Date(end).getTime() : Date.now();
      
      filteredData = timeSeries.filter(point => 
        point.timestamp >= startTime && point.timestamp <= endTime
      );
    }
    
    res.json({
      success: true,
      metric: metricName,
      dataPoints: filteredData.length,
      data: filteredData
    });
  } catch (error) {
    logger.error(`Failed to get metric data for ${req.params.metricName}:`, error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve metric data'
    });
  }
});

/**
 * GET /api/analytics/reports/generate
 * Generate analytics report
 */
router.get('/reports/generate', ensureDashboard, async (req, res) => {
  try {
    const { period = '24h', format = 'json' } = req.query;
    
    const report = await performanceDashboard.generateAnalyticsReport({ period });
    
    res.json({
      success: true,
      report
    });
  } catch (error) {
    logger.error('Failed to generate analytics report:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate report'
    });
  }
});

/**
 * GET /api/analytics/insights
 * Get performance insights and recommendations
 */
router.get('/insights', ensureDashboard, (req, res) => {
  try {
    const dashboardData = performanceDashboard.getDashboardData();
    
    const insights = {
      systemHealth: dashboardData.overview.status,
      activeAlerts: dashboardData.alerts.filter(a => a.severity === 'warning' || a.severity === 'critical'),
      topBottlenecks: dashboardData.bottlenecks.slice(0, 5),
      predictions: dashboardData.predictions.slice(0, 10),
      recommendations: generateRecommendations(dashboardData)
    };
    
    res.json({
      success: true,
      timestamp: Date.now(),
      insights
    });
  } catch (error) {
    logger.error('Failed to get performance insights:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve insights'
    });
  }
});

/**
 * GET /api/analytics/alerts
 * Get active performance alerts
 */
router.get('/alerts', ensureDashboard, (req, res) => {
  try {
    const { severity, limit = 50 } = req.query;
    const dashboardData = performanceDashboard.getDashboardData();
    
    let alerts = dashboardData.alerts;
    
    // Filter by severity if provided
    if (severity) {
      alerts = alerts.filter(a => a.severity === severity);
    }
    
    // Apply limit
    alerts = alerts.slice(0, parseInt(limit));
    
    res.json({
      success: true,
      timestamp: Date.now(),
      totalAlerts: dashboardData.alerts.length,
      alerts
    });
  } catch (error) {
    logger.error('Failed to get alerts:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve alerts'
    });
  }
});

/**
 * POST /api/analytics/alerts/acknowledge/:alertId
 * Acknowledge a performance alert
 */
router.post('/alerts/acknowledge/:alertId', ensureDashboard, (req, res) => {
  try {
    const { alertId } = req.params;
    const { acknowledgedBy, notes } = req.body;
    
    // In a real implementation, this would update the alert status
    logger.info(`Alert ${alertId} acknowledged by ${acknowledgedBy}`);
    
    res.json({
      success: true,
      alertId,
      acknowledgedAt: Date.now(),
      acknowledgedBy,
      notes
    });
  } catch (error) {
    logger.error('Failed to acknowledge alert:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to acknowledge alert'
    });
  }
});

/**
 * GET /api/analytics/export
 * Export dashboard data
 */
router.get('/export', ensureDashboard, async (req, res) => {
  try {
    const { format = 'json' } = req.query;
    
    const exportData = await performanceDashboard.exportDashboardData(format);
    
    // Set appropriate headers based on format
    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=performance-data.csv');
    } else if (format === 'pdf') {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename=performance-report.pdf');
    } else {
      res.setHeader('Content-Type', 'application/json');
    }
    
    res.send(exportData);
  } catch (error) {
    logger.error('Failed to export dashboard data:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to export data'
    });
  }
});

/**
 * GET /api/analytics/realtime
 * Get real-time performance updates (SSE endpoint)
 */
router.get('/realtime', ensureDashboard, (req, res) => {
  // Set up Server-Sent Events
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });
  
  // Send initial connection message
  res.write('data: {"type": "connected", "timestamp": ' + Date.now() + '}\n\n');
  
  // Set up dashboard update listener
  const updateHandler = (data) => {
    res.write(`data: ${JSON.stringify({
      type: 'dashboard_update',
      ...data
    })}\n\n`);
  };
  
  const alertHandler = (alert) => {
    res.write(`data: ${JSON.stringify({
      type: 'alert',
      alert
    })}\n\n`);
  };
  
  // Subscribe to dashboard events
  performanceDashboard.on('dashboardUpdate', updateHandler);
  performanceDashboard.on('alertRaised', alertHandler);
  
  // Clean up on client disconnect
  req.on('close', () => {
    performanceDashboard.removeListener('dashboardUpdate', updateHandler);
    performanceDashboard.removeListener('alertRaised', alertHandler);
  });
});

/**
 * GET /api/analytics/optimization/status
 * Get optimization system status
 */
router.get('/optimization/status', ensureDashboard, (req, res) => {
  try {
    const optimizer = performanceDashboard.performanceOptimizer;
    
    const status = {
      optimizationMode: optimizer.config.optimizationMode,
      autoOptimization: optimizer.config.autoOptimization,
      activeOptimizations: optimizer.currentOptimizations.size,
      optimizationHistory: optimizer.optimizationHistory.length,
      components: {
        startupOptimizer: !!optimizer.startupOptimizer,
        cacheManager: !!optimizer.cacheManager,
        profiler: !!optimizer.profiler,
        bottleneckAnalyzer: !!optimizer.bottleneckAnalyzer,
        predictiveScaler: !!optimizer.predictiveScaler,
        resourcePredictor: !!optimizer.resourcePredictor
      }
    };
    
    res.json({
      success: true,
      status
    });
  } catch (error) {
    logger.error('Failed to get optimization status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve optimization status'
    });
  }
});

/**
 * POST /api/analytics/optimization/trigger
 * Manually trigger optimization
 */
router.post('/optimization/trigger', ensureDashboard, async (req, res) => {
  try {
    const { targetComponent, options = {} } = req.body;
    
    const optimizer = performanceDashboard.performanceOptimizer;
    
    // Trigger optimization
    let result;
    if (targetComponent) {
      result = await optimizer.optimizeComponent(targetComponent, options);
    } else {
      result = await optimizer.runOptimizationCycle();
    }
    
    res.json({
      success: true,
      optimizationId: result.id,
      status: result.status,
      improvements: result.improvements
    });
  } catch (error) {
    logger.error('Failed to trigger optimization:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to trigger optimization'
    });
  }
});

/**
 * GET /api/analytics/predictions
 * Get performance predictions
 */
router.get('/predictions', ensureDashboard, (req, res) => {
  try {
    const { horizon = 24 } = req.query; // Default 24 hours
    const dashboardData = performanceDashboard.getDashboardData();
    
    const predictions = {
      demand: dashboardData.predictions.slice(0, parseInt(horizon)),
      resourceRequirements: calculateResourcePredictions(dashboardData.predictions),
      scalingRecommendations: generateScalingRecommendations(dashboardData.predictions),
      confidenceScore: calculateConfidenceScore(dashboardData.predictions)
    };
    
    res.json({
      success: true,
      horizon: parseInt(horizon),
      predictions
    });
  } catch (error) {
    logger.error('Failed to get predictions:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve predictions'
    });
  }
});

/**
 * Helper functions
 */

function generateRecommendations(dashboardData) {
  const recommendations = [];
  
  // Check for high resource utilization
  const latestMetrics = dashboardData.performance.current;
  if (latestMetrics.cpu && latestMetrics.cpu.value > 80) {
    recommendations.push({
      type: 'resource',
      priority: 'high',
      message: 'High CPU utilization detected. Consider scaling horizontally.',
      action: 'scale_up'
    });
  }
  
  // Check for poor cache performance
  if (dashboardData.cache.hitRate < 0.7) {
    recommendations.push({
      type: 'performance',
      priority: 'medium',
      message: 'Low cache hit rate. Review cache configuration.',
      action: 'optimize_cache'
    });
  }
  
  // Check for bottlenecks
  if (dashboardData.bottlenecks.length > 5) {
    recommendations.push({
      type: 'bottleneck',
      priority: 'high',
      message: 'Multiple bottlenecks detected. Performance optimization needed.',
      action: 'analyze_bottlenecks'
    });
  }
  
  return recommendations;
}

function calculateResourcePredictions(predictions) {
  if (!predictions || predictions.length === 0) {
    return { cpu: 0, memory: 0, containers: 0 };
  }
  
  const maxDemand = Math.max(...predictions.map(p => p.value));
  
  return {
    cpu: Math.ceil(maxDemand * 0.5), // 0.5 CPU per job
    memory: Math.ceil(maxDemand * 2048), // 2GB per job
    containers: Math.ceil(maxDemand * 1.2) // 20% buffer
  };
}

function generateScalingRecommendations(predictions) {
  if (!predictions || predictions.length === 0) {
    return [];
  }
  
  const recommendations = [];
  const currentTime = Date.now();
  
  for (const prediction of predictions) {
    const timeUntil = prediction.timestamp - currentTime;
    
    if (timeUntil > 0 && timeUntil <= 300000) { // Within 5 minutes
      if (prediction.value > 50 && prediction.confidence > 0.8) {
        recommendations.push({
          timestamp: prediction.timestamp,
          action: 'scale_up',
          targetCapacity: Math.ceil(prediction.value * 1.2),
          confidence: prediction.confidence
        });
      }
    }
  }
  
  return recommendations;
}

function calculateConfidenceScore(predictions) {
  if (!predictions || predictions.length === 0) {
    return 0;
  }
  
  const avgConfidence = predictions.reduce((sum, p) => sum + p.confidence, 0) / predictions.length;
  return Math.round(avgConfidence * 100) / 100;
}

module.exports = {
  router,
  initializePerformanceAnalytics
};