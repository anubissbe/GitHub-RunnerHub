/**
 * Container Orchestration Module
 * Main entry point for the container orchestration system
 */

const ContainerOrchestrator = require('./orchestrator');
const DockerAPIManager = require('./docker/docker-api');
const ContainerLifecycleManager = require('./lifecycle/container-lifecycle');
const ContainerMonitor = require('./monitoring/container-monitoring');
const ContainerCleanupManager = require('./cleanup/container-cleanup');

module.exports = {
  ContainerOrchestrator,
  DockerAPIManager,
  ContainerLifecycleManager,
  ContainerMonitor,
  ContainerCleanupManager
};