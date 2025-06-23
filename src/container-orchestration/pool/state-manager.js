/**
 * Container State Management System
 * Advanced state tracking and management for container pool operations
 */

const EventEmitter = require('events');
const logger = require('../../utils/logger');

class ContainerStateManager extends EventEmitter {
  constructor(poolManager, options = {}) {
    super();
    
    this.poolManager = poolManager;
    
    this.config = {
      // State tracking configuration
      tracking: {
        enableDetailedTracking: options.enableDetailedTracking !== false,
        stateHistorySize: options.stateHistorySize || 1000,
        snapshotInterval: options.snapshotInterval || 60000, // 1 minute
        persistState: options.persistState !== false
      },
      
      // State validation
      validation: {
        enableStateValidation: options.enableStateValidation !== false,
        validationInterval: options.validationInterval || 30000, // 30 seconds
        autoCorrectInconsistencies: options.autoCorrectInconsistencies !== false,
        maxInconsistencyRetries: options.maxInconsistencyRetries || 3
      },
      
      // State persistence
      persistence: {
        enablePersistence: options.enablePersistence !== false,
        persistenceInterval: options.persistenceInterval || 300000, // 5 minutes
        maxStateFileSize: options.maxStateFileSize || 50 * 1024 * 1024, // 50MB
        compressionEnabled: options.compressionEnabled !== false
      },
      
      // Recovery configuration
      recovery: {
        enableAutoRecovery: options.enableAutoRecovery !== false,
        recoveryTimeout: options.recoveryTimeout || 30000, // 30 seconds
        maxRecoveryAttempts: options.maxRecoveryAttempts || 3,
        orphanContainerThreshold: options.orphanContainerThreshold || 300000 // 5 minutes
      },
      
      ...options
    };
    
    // State definitions
    this.validStates = new Set([
      'initializing',
      'created',
      'starting',
      'running',
      'available',
      'busy',
      'stopping',
      'stopped',
      'failed',
      'recycling',
      'unknown'
    ]);
    
    // State transitions
    this.validTransitions = new Map([
      ['initializing', new Set(['created', 'failed'])],
      ['created', new Set(['starting', 'failed'])],
      ['starting', new Set(['running', 'failed'])],
      ['running', new Set(['available', 'busy', 'stopping', 'failed'])],
      ['available', new Set(['busy', 'stopping', 'recycling', 'failed'])],
      ['busy', new Set(['available', 'stopping', 'recycling', 'failed'])],
      ['stopping', new Set(['stopped', 'failed'])],
      ['stopped', new Set(['starting', 'recycling'])],
      ['failed', new Set(['recycling', 'starting'])],
      ['recycling', new Set(['initializing'])],
      ['unknown', new Set(['initializing', 'failed', 'recycling'])]
    ]);
    
    // State tracking
    this.containerStates = new Map(); // containerId -> state info
    this.stateHistory = []; // historical state changes
    this.stateSnapshots = []; // periodic state snapshots
    this.pendingTransitions = new Map(); // containerId -> pending transition
    
    // State metrics
    this.stateMetrics = {
      totalStateChanges: 0,
      stateDistribution: new Map(),
      transitionCounts: new Map(),
      invalidTransitionAttempts: 0,
      recoveryEvents: 0,
      inconsistencyDetections: 0
    };
    
    // Validation and recovery
    this.validationResults = new Map();
    this.recoveryAttempts = new Map();
    this.orphanedContainers = new Set();
    
    this.snapshotTimer = null;
    this.validationTimer = null;
    this.persistenceTimer = null;
    this.isStarted = false;
  }

  /**
   * Start state management system
   */
  start() {
    if (this.isStarted) {
      logger.warn('Container state manager already started');
      return;
    }
    
    logger.info('Starting Container State Management System');
    
    // Initialize existing container states
    this.initializeExistingContainerStates();
    
    // Start monitoring timers
    if (this.config.tracking.snapshotInterval > 0) {
      this.snapshotTimer = setInterval(() => {
        this.takeStateSnapshot().catch(error => {
          logger.error('State snapshot failed:', error);
        });
      }, this.config.tracking.snapshotInterval);
    }
    
    if (this.config.validation.enableStateValidation) {
      this.validationTimer = setInterval(() => {
        this.validateContainerStates().catch(error => {
          logger.error('State validation failed:', error);
        });
      }, this.config.validation.validationInterval);
    }
    
    if (this.config.persistence.enablePersistence) {
      this.persistenceTimer = setInterval(() => {
        this.persistState().catch(error => {
          logger.error('State persistence failed:', error);
        });
      }, this.config.persistence.persistenceInterval);
    }
    
    this.isStarted = true;
    this.emit('started');
    
    logger.info('Container state management system started');
  }

  /**
   * Stop state management system
   */
  stop() {
    if (!this.isStarted) {
      return;
    }
    
    logger.info('Stopping Container State Management System');
    
    // Clear timers
    if (this.snapshotTimer) {
      clearInterval(this.snapshotTimer);
      this.snapshotTimer = null;
    }
    
    if (this.validationTimer) {
      clearInterval(this.validationTimer);
      this.validationTimer = null;
    }
    
    if (this.persistenceTimer) {
      clearInterval(this.persistenceTimer);
      this.persistenceTimer = null;
    }
    
    // Final state persistence
    if (this.config.persistence.enablePersistence) {
      this.persistState().catch(error => {
        logger.error('Final state persistence failed:', error);
      });
    }
    
    this.isStarted = false;
    this.emit('stopped');
    
    logger.info('Container state management system stopped');
  }

  /**
   * Initialize states for existing containers
   */
  initializeExistingContainerStates() {
    for (const [containerId, containerInfo] of this.poolManager.containers) {
      const currentState = containerInfo.status || 'unknown';
      
      this.containerStates.set(containerId, {
        currentState,
        previousState: null,
        stateEnteredAt: containerInfo.createdAt || new Date(),
        stateHistory: [{
          state: currentState,
          timestamp: containerInfo.createdAt || new Date(),
          reason: 'initialization'
        }],
        metadata: {
          createdAt: containerInfo.createdAt,
          lastTransition: null,
          transitionCount: 0,
          validationFailures: 0
        }
      });
      
      // Update state distribution
      this.updateStateDistribution(currentState);
    }
    
    logger.info(`Initialized states for ${this.containerStates.size} existing containers`);
  }

  /**
   * Transition container to new state
   */
  async transitionContainer(containerId, newState, reason = '', metadata = {}) {
    try {
      const currentStateInfo = this.containerStates.get(containerId);
      
      if (!currentStateInfo) {
        // New container - initialize state
        return this.initializeContainerState(containerId, newState, reason, metadata);
      }
      
      const currentState = currentStateInfo.currentState;
      
      // Validate state transition
      if (!this.isValidTransition(currentState, newState)) {
        this.stateMetrics.invalidTransitionAttempts++;
        const error = new Error(`Invalid state transition from ${currentState} to ${newState} for container ${containerId}`);
        logger.error(error.message);
        this.emit('invalidTransition', {
          containerId,
          fromState: currentState,
          toState: newState,
          reason,
          error: error.message
        });
        throw error;
      }
      
      // Check for pending transitions
      if (this.pendingTransitions.has(containerId)) {
        logger.warn(`Container ${containerId} has pending transition, cancelling previous`);
        this.pendingTransitions.delete(containerId);
      }
      
      // Mark transition as pending
      this.pendingTransitions.set(containerId, {
        fromState: currentState,
        toState: newState,
        startedAt: new Date(),
        reason,
        metadata
      });
      
      // Execute state transition
      await this.executeStateTransition(containerId, currentState, newState, reason, metadata);
      
      // Remove pending transition
      this.pendingTransitions.delete(containerId);
      
      logger.debug(`Container ${containerId.substring(0, 12)} transitioned: ${currentState} -> ${newState} (${reason})`);
      
    } catch (error) {
      // Remove pending transition on error
      this.pendingTransitions.delete(containerId);
      logger.error(`State transition failed for container ${containerId}:`, error);
      throw error;
    }
  }

  /**
   * Initialize container state
   */
  initializeContainerState(containerId, initialState, reason = 'created', metadata = {}) {
    const stateInfo = {
      currentState: initialState,
      previousState: null,
      stateEnteredAt: new Date(),
      stateHistory: [{
        state: initialState,
        timestamp: new Date(),
        reason,
        metadata
      }],
      metadata: {
        createdAt: new Date(),
        lastTransition: null,
        transitionCount: 0,
        validationFailures: 0,
        ...metadata
      }
    };
    
    this.containerStates.set(containerId, stateInfo);
    this.updateStateDistribution(initialState);
    this.recordStateChange(containerId, null, initialState, reason, metadata);
    
    this.emit('stateInitialized', {
      containerId,
      state: initialState,
      reason,
      metadata
    });
    
    logger.debug(`Initialized state for container ${containerId.substring(0, 12)}: ${initialState}`);
  }

  /**
   * Execute state transition
   */
  async executeStateTransition(containerId, fromState, toState, reason, metadata) {
    const stateInfo = this.containerStates.get(containerId);
    const now = new Date();
    
    // Update state info
    stateInfo.previousState = fromState;
    stateInfo.currentState = toState;
    stateInfo.stateEnteredAt = now;
    stateInfo.metadata.lastTransition = now;
    stateInfo.metadata.transitionCount++;
    
    // Add to state history
    stateInfo.stateHistory.push({
      state: toState,
      timestamp: now,
      reason,
      metadata,
      duration: now.getTime() - stateInfo.stateEnteredAt.getTime()
    });
    
    // Keep history limited
    if (stateInfo.stateHistory.length > 100) {
      stateInfo.stateHistory.shift();
    }
    
    // Update metrics
    this.updateStateDistribution(fromState, -1);
    this.updateStateDistribution(toState, 1);
    this.updateTransitionCount(fromState, toState);
    this.stateMetrics.totalStateChanges++;
    
    // Record state change
    this.recordStateChange(containerId, fromState, toState, reason, metadata);
    
    // Execute state-specific actions
    await this.executeStateActions(containerId, toState, metadata);
    
    this.emit('stateTransitioned', {
      containerId,
      fromState,
      toState,
      reason,
      metadata,
      timestamp: now
    });
  }

  /**
   * Execute state-specific actions
   */
  async executeStateActions(containerId, state, metadata) {
    try {
      switch (state) {
        case 'failed':
          await this.handleFailedState(containerId, metadata);
          break;
          
        case 'recycling':
          await this.handleRecyclingState(containerId, metadata);
          break;
          
        case 'stopping':
          await this.handleStoppingState(containerId, metadata);
          break;
          
        case 'available':
          await this.handleAvailableState(containerId, metadata);
          break;
          
        case 'busy':
          await this.handleBusyState(containerId, metadata);
          break;
      }
    } catch (error) {
      logger.error(`State action execution failed for ${state}:`, error);
    }
  }

  /**
   * Handle failed state
   */
  async handleFailedState(containerId, _metadata) {
    logger.warn(`Container ${containerId.substring(0, 12)} entered failed state: ${metadata.error || 'unknown error'}`);
    
    // Schedule for recovery if auto-recovery is enabled
    if (this.config.recovery.enableAutoRecovery) {
      this.scheduleRecovery(containerId, metadata);
    }
  }

  /**
   * Handle recycling state
   */
  async handleRecyclingState(containerId, _metadata) {
    logger.debug(`Container ${containerId.substring(0, 12)} is being recycled`);
    
    // Clean up state tracking for recycled container
    setTimeout(() => {
      this.cleanupContainerState(containerId);
    }, 5000); // 5 second delay to allow recycling to complete
  }

  /**
   * Handle stopping state
   */
  async handleStoppingState(containerId, _metadata) {
    logger.debug(`Container ${containerId.substring(0, 12)} is stopping`);
    
    // Set timeout for forced stop if needed
    setTimeout(() => {
      const stateInfo = this.containerStates.get(containerId);
      if (stateInfo && stateInfo.currentState === 'stopping') {
        logger.warn(`Container ${containerId.substring(0, 12)} stuck in stopping state, marking as failed`);
        this.transitionContainer(containerId, 'failed', 'stop timeout').catch(error => {
          logger.error('Failed to transition stuck container:', error);
        });
      }
    }, 30000); // 30 second timeout
  }

  /**
   * Handle available state
   */
  async handleAvailableState(containerId, _metadata) {
    logger.debug(`Container ${containerId.substring(0, 12)} is now available`);
    
    // Update pool manager's available containers
    if (!this.poolManager.availableContainers.has(containerId)) {
      this.poolManager.availableContainers.add(containerId);
    }
    
    // Remove from busy containers if present
    this.poolManager.busyContainers.delete(containerId);
  }

  /**
   * Handle busy state
   */
  async handleBusyState(containerId, _metadata) {
    logger.debug(`Container ${containerId.substring(0, 12)} is now busy`);
    
    // Update pool manager's busy containers
    if (!this.poolManager.busyContainers.has(containerId)) {
      this.poolManager.busyContainers.add(containerId);
    }
    
    // Remove from available containers
    this.poolManager.availableContainers.delete(containerId);
  }

  /**
   * Get container state
   */
  getContainerState(containerId) {
    const stateInfo = this.containerStates.get(containerId);
    return stateInfo ? stateInfo.currentState : 'unknown';
  }

  /**
   * Get detailed container state info
   */
  getContainerStateInfo(containerId) {
    return this.containerStates.get(containerId) || null;
  }

  /**
   * Check if state transition is valid
   */
  isValidTransition(fromState, toState) {
    if (!this.validStates.has(fromState) || !this.validStates.has(toState)) {
      return false;
    }
    
    const validNext = this.validTransitions.get(fromState);
    return validNext ? validNext.has(toState) : false;
  }

  /**
   * Validate container states
   */
  async validateContainerStates() {
    let inconsistencies = 0;
    const validationResults = [];
    
    for (const [containerId, stateInfo] of this.containerStates) {
      try {
        const validationResult = await this.validateContainerState(containerId, stateInfo);
        validationResults.push(validationResult);
        
        if (!validationResult.isValid) {
          inconsistencies++;
          this.stateMetrics.inconsistencyDetections++;
          
          if (this.config.validation.autoCorrectInconsistencies) {
            await this.correctStateInconsistency(containerId, validationResult);
          }
        }
      } catch (error) {
        logger.error(`State validation failed for container ${containerId}:`, error);
      }
    }
    
    // Check for orphaned containers
    await this.detectOrphanedContainers();
    
    this.validationResults.set(Date.now(), {
      totalContainers: this.containerStates.size,
      inconsistencies,
      orphanedContainers: this.orphanedContainers.size,
      validationResults
    });
    
    if (inconsistencies > 0) {
      logger.warn(`State validation found ${inconsistencies} inconsistencies`);
    }
    
    this.emit('validationCompleted', {
      inconsistencies,
      orphanedContainers: this.orphanedContainers.size,
      totalContainers: this.containerStates.size
    });
  }

  /**
   * Validate individual container state
   */
  async validateContainerState(containerId, stateInfo) {
    const validationResult = {
      containerId,
      isValid: true,
      issues: [],
      actualState: null,
      expectedState: stateInfo.currentState
    };
    
    try {
      // Check if container exists in pool manager
      const containerInfo = this.poolManager.containers.get(containerId);
      
      if (!containerInfo) {
        validationResult.isValid = false;
        validationResult.issues.push('Container not found in pool manager');
        return validationResult;
      }
      
      validationResult.actualState = containerInfo.status;
      
      // Check state consistency
      if (containerInfo.status !== stateInfo.currentState) {
        validationResult.isValid = false;
        validationResult.issues.push(`State mismatch: expected ${stateInfo.currentState}, actual ${containerInfo.status}`);
      }
      
      // Check Docker container state
      try {
        const dockerContainer = this.poolManager.docker.getContainer(containerId);
        const dockerInfo = await dockerContainer.inspect();
        
        const dockerState = this.mapDockerStateToPoolState(dockerInfo.State);
        
        if (dockerState !== stateInfo.currentState && 
            !this.isCompatibleState(dockerState, stateInfo.currentState)) {
          validationResult.isValid = false;
          validationResult.issues.push(`Docker state mismatch: expected ${stateInfo.currentState}, Docker shows ${dockerState}`);
        }
      } catch (error) {
        if (stateInfo.currentState !== 'failed' && stateInfo.currentState !== 'recycling') {
          validationResult.isValid = false;
          validationResult.issues.push(`Docker container not accessible: ${error.message}`);
        }
      }
      
      // Check state duration for potential stuck states
      const stateDuration = Date.now() - stateInfo.stateEnteredAt.getTime();
      const maxDuration = this.getMaxStateDuration(stateInfo.currentState);
      
      if (maxDuration > 0 && stateDuration > maxDuration) {
        validationResult.isValid = false;
        validationResult.issues.push(`State duration exceeded: ${stateDuration}ms > ${maxDuration}ms`);
      }
      
    } catch (error) {
      validationResult.isValid = false;
      validationResult.issues.push(`Validation error: ${error.message}`);
    }
    
    return validationResult;
  }

  /**
   * Map Docker state to pool state
   */
  mapDockerStateToPoolState(dockerState) {
    if (dockerState.Running) {
      return 'running';
    } else if (dockerState.Paused) {
      return 'stopped';
    } else if (dockerState.Restarting) {
      return 'starting';
    } else if (dockerState.Dead || dockerState.OOMKilled) {
      return 'failed';
    } else {
      return 'stopped';
    }
  }

  /**
   * Check if states are compatible
   */
  isCompatibleState(state1, state2) {
    const compatibleStates = new Map([
      ['running', new Set(['available', 'busy'])],
      ['available', new Set(['running'])],
      ['busy', new Set(['running'])]
    ]);
    
    const compatible = compatibleStates.get(state1);
    return compatible ? compatible.has(state2) : state1 === state2;
  }

  /**
   * Get maximum duration for state
   */
  getMaxStateDuration(state) {
    const maxDurations = {
      'starting': 60000,    // 1 minute
      'stopping': 30000,    // 30 seconds
      'recycling': 120000   // 2 minutes
    };
    
    return maxDurations[state] || 0;
  }

  /**
   * Correct state inconsistency
   */
  async correctStateInconsistency(containerId, validationResult) {
    try {
      logger.warn(`Correcting state inconsistency for container ${containerId.substring(0, 12)}`);
      
      const stateInfo = this.containerStates.get(containerId);
      
      // Determine correct state
      let correctState = 'unknown';
      
      if (validationResult.actualState) {
        correctState = validationResult.actualState;
      } else if (validationResult.issues.some(issue => issue.includes('not accessible'))) {
        correctState = 'failed';
      }
      
      // Force state transition
      if (correctState !== 'unknown' && correctState !== stateInfo.currentState) {
        await this.forceStateTransition(containerId, correctState, 'inconsistency correction');
      }
      
    } catch (error) {
      logger.error(`Failed to correct state inconsistency for container ${containerId}:`, error);
    }
  }

  /**
   * Force state transition (bypasses validation)
   */
  async forceStateTransition(containerId, newState, reason) {
    const stateInfo = this.containerStates.get(containerId);
    
    if (!stateInfo) {
      this.initializeContainerState(containerId, newState, reason);
      return;
    }
    
    const oldState = stateInfo.currentState;
    
    // Execute transition without validation
    await this.executeStateTransition(containerId, oldState, newState, reason, { forced: true });
    
    logger.warn(`Forced state transition for ${containerId.substring(0, 12)}: ${oldState} -> ${newState} (${reason})`);
  }

  /**
   * Detect orphaned containers
   */
  async detectOrphanedContainers() {
    this.orphanedContainers.clear();
    
    try {
      // Get all Docker containers with pool labels
      const containers = await this.poolManager.docker.listContainers({
        all: true,
        filters: {
          label: ['runnerhub.pool=true']
        }
      });
      
      for (const container of containers) {
        const containerId = container.Id;
        
        // Check if container is tracked in our state management
        if (!this.containerStates.has(containerId)) {
          this.orphanedContainers.add(containerId);
          
          logger.warn(`Detected orphaned container: ${containerId.substring(0, 12)}`);
          
          // Initialize state for orphaned container
          this.initializeContainerState(containerId, 'unknown', 'orphan detection');
        }
      }
      
    } catch (error) {
      logger.error('Failed to detect orphaned containers:', error);
    }
  }

  /**
   * Schedule recovery for failed container
   */
  scheduleRecovery(containerId, _metadata) {
    const attempts = this.recoveryAttempts.get(containerId) || 0;
    
    if (attempts >= this.config.recovery.maxRecoveryAttempts) {
      logger.warn(`Max recovery attempts reached for container ${containerId.substring(0, 12)}`);
      return;
    }
    
    this.recoveryAttempts.set(containerId, attempts + 1);
    
    setTimeout(async () => {
      try {
        await this.attemptContainerRecovery(containerId);
      } catch (error) {
        logger.error(`Recovery attempt failed for container ${containerId}:`, error);
      }
    }, this.config.recovery.recoveryTimeout);
  }

  /**
   * Attempt container recovery
   */
  async attemptContainerRecovery(containerId) {
    const stateInfo = this.containerStates.get(containerId);
    
    if (!stateInfo || stateInfo.currentState !== 'failed') {
      return; // Container state changed, recovery not needed
    }
    
    logger.info(`Attempting recovery for container ${containerId.substring(0, 12)}`);
    
    try {
      // Try to restart container
      const dockerContainer = this.poolManager.docker.getContainer(containerId);
      await dockerContainer.restart();
      
      // Transition to starting state
      await this.transitionContainer(containerId, 'starting', 'recovery attempt');
      
      // Wait and check if container is healthy
      setTimeout(async () => {
        try {
          const containerInfo = await dockerContainer.inspect();
          if (containerInfo.State.Running) {
            await this.transitionContainer(containerId, 'available', 'recovery successful');
            this.recoveryAttempts.delete(containerId);
            this.stateMetrics.recoveryEvents++;
            
            logger.info(`Container ${containerId.substring(0, 12)} recovered successfully`);
          } else {
            throw new Error('Container not running after restart');
          }
        } catch (error) {
          logger.error(`Recovery verification failed for container ${containerId}:`, error);
          await this.transitionContainer(containerId, 'failed', 'recovery failed');
        }
      }, 10000); // 10 second delay
      
    } catch (error) {
      logger.error(`Container recovery failed for ${containerId}:`, error);
      
      // Schedule recycling if recovery fails
      await this.transitionContainer(containerId, 'recycling', 'recovery failed, scheduling recycling');
    }
  }

  /**
   * Take state snapshot
   */
  async takeStateSnapshot() {
    const snapshot = {
      timestamp: new Date(),
      containerCount: this.containerStates.size,
      stateDistribution: new Map(this.stateMetrics.stateDistribution),
      pendingTransitions: this.pendingTransitions.size,
      orphanedContainers: this.orphanedContainers.size,
      containers: {}
    };
    
    // Include detailed container info if enabled
    if (this.config.tracking.enableDetailedTracking) {
      for (const [containerId, stateInfo] of this.containerStates) {
        snapshot.containers[containerId] = {
          state: stateInfo.currentState,
          stateEnteredAt: stateInfo.stateEnteredAt,
          transitionCount: stateInfo.metadata.transitionCount
        };
      }
    }
    
    this.stateSnapshots.push(snapshot);
    
    // Keep snapshots limited
    if (this.stateSnapshots.length > 100) {
      this.stateSnapshots.shift();
    }
    
    this.emit('snapshotTaken', snapshot);
  }

  /**
   * Record state change
   */
  recordStateChange(containerId, fromState, toState, reason, metadata) {
    const stateChange = {
      timestamp: new Date(),
      containerId,
      fromState,
      toState,
      reason,
      metadata
    };
    
    this.stateHistory.push(stateChange);
    
    // Keep history limited
    if (this.stateHistory.length > this.config.tracking.stateHistorySize) {
      this.stateHistory.shift();
    }
  }

  /**
   * Update state distribution metrics
   */
  updateStateDistribution(state, delta = 1) {
    const current = this.stateMetrics.stateDistribution.get(state) || 0;
    this.stateMetrics.stateDistribution.set(state, Math.max(0, current + delta));
  }

  /**
   * Update transition count metrics
   */
  updateTransitionCount(fromState, toState) {
    const transitionKey = `${fromState}->${toState}`;
    const current = this.stateMetrics.transitionCounts.get(transitionKey) || 0;
    this.stateMetrics.transitionCounts.set(transitionKey, current + 1);
  }

  /**
   * Clean up container state
   */
  cleanupContainerState(containerId) {
    this.containerStates.delete(containerId);
    this.pendingTransitions.delete(containerId);
    this.recoveryAttempts.delete(containerId);
    this.orphanedContainers.delete(containerId);
    
    logger.debug(`Cleaned up state for container ${containerId.substring(0, 12)}`);
  }

  /**
   * Persist state to storage
   */
  async persistState() {
    if (!this.config.persistence.enablePersistence) {
      return;
    }
    
    try {
      const _stateData = {
        timestamp: new Date(),
        containerStates: Object.fromEntries(this.containerStates),
        stateMetrics: {
          ...this.stateMetrics,
          stateDistribution: Object.fromEntries(this.stateMetrics.stateDistribution),
          transitionCounts: Object.fromEntries(this.stateMetrics.transitionCounts)
        },
        recentHistory: this.stateHistory.slice(-100) // Last 100 state changes
      };
      
      // In a real implementation, this would write to a file or database
      logger.debug('State persistence completed');
      
    } catch (error) {
      logger.error('State persistence failed:', error);
    }
  }

  /**
   * Get state management statistics
   */
  getStateStats() {
    return {
      isStarted: this.isStarted,
      containerCount: this.containerStates.size,
      pendingTransitions: this.pendingTransitions.size,
      orphanedContainers: this.orphanedContainers.size,
      metrics: {
        ...this.stateMetrics,
        stateDistribution: Object.fromEntries(this.stateMetrics.stateDistribution),
        transitionCounts: Object.fromEntries(this.stateMetrics.transitionCounts)
      },
      snapshots: this.stateSnapshots.length,
      historySize: this.stateHistory.length,
      recoveryAttempts: this.recoveryAttempts.size,
      config: {
        detailedTracking: this.config.tracking.enableDetailedTracking,
        stateValidation: this.config.validation.enableStateValidation,
        autoRecovery: this.config.recovery.enableAutoRecovery,
        persistence: this.config.persistence.enablePersistence
      }
    };
  }

  /**
   * Get state history
   */
  getStateHistory(containerId = null, limit = 50) {
    let history = this.stateHistory;
    
    if (containerId) {
      history = history.filter(change => change.containerId === containerId);
    }
    
    return history.slice(-limit).map(change => ({
      ...change,
      timestamp: change.timestamp.toISOString()
    }));
  }

  /**
   * Get current state distribution
   */
  getStateDistribution() {
    const distribution = {};
    const total = this.containerStates.size;
    
    for (const [state, count] of this.stateMetrics.stateDistribution) {
      distribution[state] = {
        count,
        percentage: total > 0 ? (count / total) * 100 : 0
      };
    }
    
    return distribution;
  }

  /**
   * Get containers in specific state
   */
  getContainersInState(state) {
    const containers = [];
    
    for (const [containerId, stateInfo] of this.containerStates) {
      if (stateInfo.currentState === state) {
        containers.push({
          id: containerId.substring(0, 12),
          stateEnteredAt: stateInfo.stateEnteredAt,
          duration: Date.now() - stateInfo.stateEnteredAt.getTime(),
          transitionCount: stateInfo.metadata.transitionCount
        });
      }
    }
    
    return containers.sort((a, b) => b.duration - a.duration);
  }
}

module.exports = ContainerStateManager;