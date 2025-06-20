/**
 * Leader Election Service for GitHub RunnerHub High Availability
 * 
 * This service implements leader election using Redis to ensure only one
 * orchestrator instance performs singleton operations like cleanup and monitoring.
 */

import Redis from 'ioredis';
import { EventEmitter } from 'events';
import { createLogger } from '../utils/logger';
import { config } from '../config';

export interface LeaderElectionConfig {
    nodeId: string;
    lockKey: string;
    lockTTL: number;
    renewalInterval: number;
    retryInterval: number;
    maxRetries: number;
}

export interface LeadershipStatus {
    isLeader: boolean;
    currentLeader: string | null;
    leaderSince: Date | null;
    renewalCount: number;
    lastRenewal: Date | null;
}

export class LeaderElectionService extends EventEmitter {
    private redis: Redis;
    private config: LeaderElectionConfig;
    private logger: any;
    private isLeader = false;
    private currentLeader: string | null = null;
    private leaderSince: Date | null = null;
    private renewalTimer?: NodeJS.Timeout;
    private electionTimer?: NodeJS.Timeout;
    private renewalCount = 0;
    private lastRenewal: Date | null = null;
    private isShuttingDown = false;
    private retryCount = 0;

    constructor(redis: Redis, options: Partial<LeaderElectionConfig> = {}) {
        super();
        
        this.redis = redis;
        this.logger = createLogger('LeaderElection');
        
        this.config = {
            nodeId: options.nodeId || config.ha.nodeId || `node-${Date.now()}`,
            lockKey: options.lockKey || 'runnerhub:leader:lock',
            lockTTL: options.lockTTL || 30000, // 30 seconds
            renewalInterval: options.renewalInterval || 10000, // 10 seconds
            retryInterval: options.retryInterval || 5000, // 5 seconds
            maxRetries: options.maxRetries || 5
        };

        this.logger.info('Leader election service initialized', {
            nodeId: this.config.nodeId,
            lockKey: this.config.lockKey,
            lockTTL: this.config.lockTTL,
            renewalInterval: this.config.renewalInterval
        });
    }

    /**
     * Start the leader election process
     */
    async startElection(): Promise<void> {
        if (this.isShuttingDown) {
            return;
        }

        this.logger.info('Starting leader election', { nodeId: this.config.nodeId });
        
        try {
            await this.attemptLeadership();
            this.scheduleNextElection();
        } catch (error) {
            this.logger.error('Failed to start leader election', { error, nodeId: this.config.nodeId });
            this.handleElectionError(error);
        }
    }

    /**
     * Attempt to acquire leadership
     */
    private async attemptLeadership(): Promise<void> {
        try {
            const lockValue = JSON.stringify({
                nodeId: this.config.nodeId,
                timestamp: Date.now(),
                pid: process.pid
            });

            // Try to acquire the lock using SET with NX and PX options
            const result = await this.redis.set(
                this.config.lockKey,
                lockValue,
                'PX',
                this.config.lockTTL,
                'NX'
            );

            if (result === 'OK') {
                await this.becomeLeader();
            } else {
                await this.checkCurrentLeader();
            }

            this.retryCount = 0; // Reset retry count on successful operation
        } catch (error) {
            this.logger.error('Error during leadership attempt', { error, nodeId: this.config.nodeId });
            throw error;
        }
    }

    /**
     * Become the leader
     */
    private async becomeLeader(): Promise<void> {
        if (this.isLeader) {
            return; // Already leader
        }

        this.isLeader = true;
        this.currentLeader = this.config.nodeId;
        this.leaderSince = new Date();
        this.renewalCount = 0;
        this.lastRenewal = new Date();

        this.logger.info('Became leader', {
            nodeId: this.config.nodeId,
            leaderSince: this.leaderSince
        });

        this.emit('leadership:acquired', {
            nodeId: this.config.nodeId,
            timestamp: this.leaderSince
        });

        // Start renewal process
        this.startRenewalProcess();
    }

    /**
     * Start the leadership renewal process
     */
    private startRenewalProcess(): void {
        if (this.renewalTimer) {
            clearTimeout(this.renewalTimer);
        }

        this.renewalTimer = setTimeout(async () => {
            if (this.isLeader && !this.isShuttingDown) {
                await this.renewLeadership();
            }
        }, this.config.renewalInterval);
    }

    /**
     * Renew leadership by extending the lock TTL
     */
    async renewLeadership(): Promise<void> {
        if (!this.isLeader || this.isShuttingDown) {
            return;
        }

        try {
            const lockValue = JSON.stringify({
                nodeId: this.config.nodeId,
                timestamp: Date.now(),
                pid: process.pid,
                renewalCount: this.renewalCount + 1
            });

            // Use Lua script to atomically check and renew the lock
            const luaScript = `
                local key = KEYS[1]
                local new_value = ARGV[1]
                local ttl = ARGV[2]
                local node_id = ARGV[3]
                
                local current_value = redis.call('GET', key)
                if current_value then
                    local current_data = cjson.decode(current_value)
                    if current_data.nodeId == node_id then
                        redis.call('SET', key, new_value, 'PX', ttl)
                        return 1
                    else
                        return 0
                    end
                else
                    return 0
                end
            `;

            const result = await this.redis.eval(
                luaScript,
                1,
                this.config.lockKey,
                lockValue,
                this.config.lockTTL.toString(),
                this.config.nodeId
            ) as number;

            if (result === 1) {
                // Successfully renewed leadership
                this.renewalCount++;
                this.lastRenewal = new Date();
                
                this.logger.debug('Leadership renewed', {
                    nodeId: this.config.nodeId,
                    renewalCount: this.renewalCount,
                    lastRenewal: this.lastRenewal
                });

                this.emit('leadership:renewed', {
                    nodeId: this.config.nodeId,
                    renewalCount: this.renewalCount,
                    timestamp: this.lastRenewal
                });

                // Schedule next renewal
                this.startRenewalProcess();
            } else {
                // Lost leadership
                await this.loseLeadership('renewal_failed');
            }
        } catch (error) {
            this.logger.error('Failed to renew leadership', { error, nodeId: this.config.nodeId });
            await this.loseLeadership('renewal_error');
        }
    }

    /**
     * Check who the current leader is
     */
    private async checkCurrentLeader(): Promise<void> {
        try {
            const lockValue = await this.redis.get(this.config.lockKey);
            
            if (lockValue) {
                const lockData = JSON.parse(lockValue);
                const newLeader = lockData.nodeId;
                
                if (this.currentLeader !== newLeader) {
                    this.currentLeader = newLeader;
                    
                    this.logger.info('Leader changed', {
                        newLeader,
                        previousLeader: this.currentLeader,
                        nodeId: this.config.nodeId
                    });

                    this.emit('leadership:changed', {
                        newLeader,
                        timestamp: new Date(),
                        lockData
                    });
                }
            } else {
                // No current leader
                if (this.currentLeader !== null) {
                    this.currentLeader = null;
                    this.logger.info('No current leader', { nodeId: this.config.nodeId });
                    this.emit('leadership:vacant', { timestamp: new Date() });
                }
            }
        } catch (error) {
            this.logger.error('Error checking current leader', { error, nodeId: this.config.nodeId });
        }
    }

    /**
     * Lose leadership
     */
    private async loseLeadership(reason: string): Promise<void> {
        if (!this.isLeader) {
            return;
        }

        const wasLeader = this.isLeader;
        this.isLeader = false;
        this.leaderSince = null;
        this.renewalCount = 0;
        this.lastRenewal = null;

        // Clear renewal timer
        if (this.renewalTimer) {
            clearTimeout(this.renewalTimer);
            this.renewalTimer = undefined;
        }

        if (wasLeader) {
            this.logger.warn('Lost leadership', {
                nodeId: this.config.nodeId,
                reason
            });

            this.emit('leadership:lost', {
                nodeId: this.config.nodeId,
                reason,
                timestamp: new Date()
            });
        }

        // Check current leader after losing leadership
        await this.checkCurrentLeader();
    }

    /**
     * Schedule the next election attempt
     */
    private scheduleNextElection(): void {
        if (this.isShuttingDown || this.isLeader) {
            return;
        }

        if (this.electionTimer) {
            clearTimeout(this.electionTimer);
        }

        const interval = this.isLeader ? this.config.renewalInterval : this.config.retryInterval;
        
        this.electionTimer = setTimeout(async () => {
            if (!this.isShuttingDown) {
                await this.startElection();
            }
        }, interval);
    }

    /**
     * Handle election errors
     */
    private handleElectionError(error: any): void {
        this.retryCount++;
        
        if (this.retryCount >= this.config.maxRetries) {
            this.logger.error('Max retries reached for leader election', {
                error,
                retryCount: this.retryCount,
                maxRetries: this.config.maxRetries,
                nodeId: this.config.nodeId
            });

            this.emit('leadership:error', {
                error,
                retryCount: this.retryCount,
                nodeId: this.config.nodeId,
                timestamp: new Date()
            });

            // Reset retry count and continue trying after a longer delay
            this.retryCount = 0;
            setTimeout(() => {
                if (!this.isShuttingDown) {
                    this.startElection();
                }
            }, this.config.retryInterval * 3);
        } else {
            // Retry with exponential backoff
            const backoffDelay = this.config.retryInterval * Math.pow(2, this.retryCount - 1);
            setTimeout(() => {
                if (!this.isShuttingDown) {
                    this.startElection();
                }
            }, Math.min(backoffDelay, 30000)); // Max 30 second delay
        }
    }

    /**
     * Force release leadership (for graceful shutdown)
     */
    async releaseLeadership(): Promise<void> {
        if (!this.isLeader) {
            return;
        }

        this.logger.info('Releasing leadership', { nodeId: this.config.nodeId });

        try {
            // Use Lua script to atomically check and release the lock
            const luaScript = `
                local key = KEYS[1]
                local node_id = ARGV[1]
                
                local current_value = redis.call('GET', key)
                if current_value then
                    local current_data = cjson.decode(current_value)
                    if current_data.nodeId == node_id then
                        redis.call('DEL', key)
                        return 1
                    else
                        return 0
                    end
                else
                    return 0
                end
            `;

            const result = await this.redis.eval(
                luaScript,
                1,
                this.config.lockKey,
                this.config.nodeId
            ) as number;

            if (result === 1) {
                this.logger.info('Leadership released successfully', { nodeId: this.config.nodeId });
            } else {
                this.logger.warn('Failed to release leadership (not current leader)', { nodeId: this.config.nodeId });
            }
        } catch (error) {
            this.logger.error('Error releasing leadership', { error, nodeId: this.config.nodeId });
        }

        await this.loseLeadership('released');
    }

    /**
     * Stop the leader election process
     */
    async stopElection(): Promise<void> {
        this.isShuttingDown = true;
        
        this.logger.info('Stopping leader election', { nodeId: this.config.nodeId });

        // Clear timers
        if (this.renewalTimer) {
            clearTimeout(this.renewalTimer);
            this.renewalTimer = undefined;
        }

        if (this.electionTimer) {
            clearTimeout(this.electionTimer);
            this.electionTimer = undefined;
        }

        // Release leadership if we have it
        if (this.isLeader) {
            await this.releaseLeadership();
        }

        this.emit('election:stopped', {
            nodeId: this.config.nodeId,
            timestamp: new Date()
        });
    }

    /**
     * Get current leadership status
     */
    getStatus(): LeadershipStatus {
        return {
            isLeader: this.isLeader,
            currentLeader: this.currentLeader,
            leaderSince: this.leaderSince,
            renewalCount: this.renewalCount,
            lastRenewal: this.lastRenewal
        };
    }

    /**
     * Check if this node is currently the leader
     */
    isCurrentLeader(): boolean {
        return this.isLeader;
    }

    /**
     * Get the current leader node ID
     */
    getCurrentLeader(): string | null {
        return this.currentLeader;
    }

    /**
     * Force a new election (useful for testing)
     */
    async forceElection(): Promise<void> {
        if (this.isShuttingDown) {
            return;
        }

        this.logger.info('Forcing new election', { nodeId: this.config.nodeId });
        
        // Clear existing timers
        if (this.electionTimer) {
            clearTimeout(this.electionTimer);
            this.electionTimer = undefined;
        }

        await this.startElection();
    }
}

export default LeaderElectionService;