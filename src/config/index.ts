import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config();

export interface Config {
  app: {
    env: string;
    port: number;
    name: string;
  };
  github: {
    token: string;
    org: string;
    runnerVersion: string;
  };
  redis: {
    host: string;
    port: number;
    password?: string;
    maxRetriesPerRequest: number;
  };
  database: {
    url: string;
    host: string;
    port: number;
    name: string;
    user: string;
    password: string;
  };
  vault: {
    addr: string;
    token: string;
  };
  docker: {
    host: string;
    socketPath: string;
    socketProxy?: string;
  };
  runner: {
    poolMin: number;
    poolMax: number;
    scaleIncrement: number;
    scaleThreshold: number;
    idleTimeout: number;
    networkPrefix: string;
    image: string;
    jobTimeout: number;
    limits: {
      cpu: number;
      memory: number;
      pids: number;
    };
  };
  monitoring: {
    prometheusEnabled: boolean;
    prometheusPort: number;
    grafanaEnabled: boolean;
    grafanaPort: number;
  };
  security: {
    jwtSecret: string;
    encryptionKey: string;
    apiRateLimit: number;
    apiRateWindow: number;
    // Container security scanning
    scanImages: boolean;
    blockOnVulnerabilities: boolean;
    blockOnScanFailure: boolean;
    defaultPolicyId?: string;
    trivyVersion: string;
    scanTimeout: number;
    maxCriticalVulnerabilities: number;
    maxHighVulnerabilities: number;
  };
  logging: {
    level: string;
    format: string;
    dir: string;
  };
  ha: {
    enabled: boolean;
    nodeId: string;
    clusterNodes: string[];
    loadBalancerUrl?: string;
    leaderElection: {
      enabled: boolean;
      lockKey: string;
      lockTTL: number;
      renewalInterval: number;
      retryInterval: number;
      maxRetries: number;
    };
    healthCheck: {
      interval: number;
      timeout: number;
      retryCount: number;
      alertThreshold: number;
    };
    database: {
      replicaUrl?: string;
      connectionPoolSize: number;
      maxConnections: number;
      enableReadReplica: boolean;
    };
    redis: {
      sentinelHosts: string[];
      masterName: string;
      sentinelPassword?: string;
      enableSentinel: boolean;
    };
    storage: {
      sharedPath: string;
      nfsServer?: string;
      nfsMountPoint?: string;
    };
  };
}

const config: Config = {
  app: {
    env: process.env.NODE_ENV || 'development',
    port: parseInt(process.env.PORT || '3000', 10),
    name: 'GitHub-RunnerHub'
  },
  github: {
    token: process.env.GITHUB_TOKEN || '',
    org: process.env.GITHUB_ORG || '',
    runnerVersion: process.env.GITHUB_RUNNER_VERSION || '2.311.0'
  },
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD,
    maxRetriesPerRequest: 3
  },
  database: {
    url: process.env.DATABASE_URL || 'postgresql://user:password@localhost:5432/github_runnerhub',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    name: process.env.DB_NAME || 'github_runnerhub',
    user: process.env.DB_USER || 'db_user',
    password: process.env.DB_PASSWORD || 'change_me'
  },
  vault: {
    addr: process.env.VAULT_ADDR || 'http://localhost:8200',
    token: process.env.VAULT_TOKEN || ''
  },
  docker: {
    host: process.env.DOCKER_HOST || '/var/run/docker.sock',
    socketPath: process.env.DOCKER_SOCKET_PATH || '/var/run/docker.sock',
    socketProxy: process.env.DOCKER_SOCKET_PROXY
  },
  runner: {
    poolMin: parseInt(process.env.RUNNER_POOL_MIN || '1', 10),
    poolMax: parseInt(process.env.RUNNER_POOL_MAX || '10', 10),
    scaleIncrement: parseInt(process.env.RUNNER_SCALE_INCREMENT || '5', 10),
    scaleThreshold: parseFloat(process.env.RUNNER_SCALE_THRESHOLD || '0.8'),
    idleTimeout: parseInt(process.env.RUNNER_IDLE_TIMEOUT || '300', 10),
    networkPrefix: process.env.RUNNER_NETWORK_PREFIX || 'runner-net',
    image: process.env.RUNNER_IMAGE || 'myoung34/github-runner:latest',
    jobTimeout: parseInt(process.env.RUNNER_JOB_TIMEOUT || '3600000', 10),
    limits: {
      cpu: parseInt(process.env.RUNNER_CPU_LIMIT || '2048', 10),
      memory: parseInt(process.env.RUNNER_MEMORY_MB || '4096', 10),
      pids: parseInt(process.env.RUNNER_PIDS_LIMIT || '512', 10)
    }
  },
  monitoring: {
    prometheusEnabled: process.env.PROMETHEUS_ENABLED === 'true',
    prometheusPort: parseInt(process.env.PROMETHEUS_PORT || '9090', 10),
    grafanaEnabled: process.env.GRAFANA_ENABLED === 'true',
    grafanaPort: parseInt(process.env.GRAFANA_PORT || '3000', 10)
  },
  security: {
    jwtSecret: process.env.JWT_SECRET || 'change-me-in-production',
    encryptionKey: process.env.ENCRYPTION_KEY || 'change-me-in-production',
    apiRateLimit: parseInt(process.env.API_RATE_LIMIT || '100', 10),
    apiRateWindow: parseInt(process.env.API_RATE_WINDOW || '900000', 10), // 15 minutes
    // Container security scanning
    scanImages: process.env.SECURITY_SCAN_IMAGES !== 'false',
    blockOnVulnerabilities: process.env.SECURITY_BLOCK_ON_VULNERABILITIES === 'true',
    blockOnScanFailure: process.env.SECURITY_BLOCK_ON_SCAN_FAILURE === 'true',
    defaultPolicyId: process.env.SECURITY_DEFAULT_POLICY_ID,
    trivyVersion: process.env.TRIVY_VERSION || 'latest',
    scanTimeout: parseInt(process.env.SECURITY_SCAN_TIMEOUT || '300000', 10),
    maxCriticalVulnerabilities: parseInt(process.env.SECURITY_MAX_CRITICAL || '0', 10),
    maxHighVulnerabilities: parseInt(process.env.SECURITY_MAX_HIGH || '5', 10)
  },
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    format: process.env.LOG_FORMAT || 'json',
    dir: process.env.LOG_DIR || path.join(process.cwd(), 'logs')
  },
  ha: {
    enabled: process.env.HA_ENABLED === 'true',
    nodeId: process.env.HA_NODE_ID || `node-${process.pid}`,
    clusterNodes: process.env.HA_CLUSTER_NODES ? process.env.HA_CLUSTER_NODES.split(',') : [],
    loadBalancerUrl: process.env.LOAD_BALANCER_URL,
    leaderElection: {
      enabled: process.env.LEADER_ELECTION_ENABLED === 'true',
      lockKey: process.env.LEADER_ELECTION_LOCK_KEY || 'runnerhub:leader:lock',
      lockTTL: parseInt(process.env.LEADER_ELECTION_TIMEOUT || '30000', 10),
      renewalInterval: parseInt(process.env.LEADER_ELECTION_RENEWAL || '10000', 10),
      retryInterval: parseInt(process.env.LEADER_ELECTION_RETRY_INTERVAL || '5000', 10),
      maxRetries: parseInt(process.env.LEADER_ELECTION_MAX_RETRIES || '5', 10)
    },
    healthCheck: {
      interval: parseInt(process.env.HEALTH_CHECK_INTERVAL || '30000', 10),
      timeout: parseInt(process.env.HEALTH_CHECK_TIMEOUT || '5000', 10),
      retryCount: parseInt(process.env.HEALTH_CHECK_RETRIES || '3', 10),
      alertThreshold: parseInt(process.env.HEALTH_CHECK_ALERT_THRESHOLD || '3', 10)
    },
    database: {
      replicaUrl: process.env.DATABASE_REPLICA_URL,
      connectionPoolSize: parseInt(process.env.DATABASE_CONNECTION_POOL_SIZE || '20', 10),
      maxConnections: parseInt(process.env.DATABASE_MAX_CONNECTIONS || '100', 10),
      enableReadReplica: process.env.DATABASE_ENABLE_READ_REPLICA === 'true'
    },
    redis: {
      sentinelHosts: process.env.REDIS_SENTINEL_HOSTS ? process.env.REDIS_SENTINEL_HOSTS.split(',') : [],
      masterName: process.env.REDIS_MASTER_NAME || 'github-runnerhub-redis',
      sentinelPassword: process.env.REDIS_SENTINEL_PASSWORD,
      enableSentinel: process.env.REDIS_ENABLE_SENTINEL === 'true'
    },
    storage: {
      sharedPath: process.env.SHARED_STORAGE_PATH || '/shared',
      nfsServer: process.env.NFS_SERVER,
      nfsMountPoint: process.env.NFS_MOUNT_POINT
    }
  }
};

// Validate required configuration
export function validateConfig(): void {
  const required = [
    { value: config.github.token, name: 'GITHUB_TOKEN' },
    { value: config.vault.token, name: 'VAULT_TOKEN' },
    { value: config.security.jwtSecret !== 'change-me-in-production', name: 'JWT_SECRET' }
  ];

  const missing = required.filter(item => !item.value).map(item => item.name);
  
  if (missing.length > 0) {
    console.warn(`Warning: Missing configuration: ${missing.join(', ')}`);
    // In development, allow missing config for testing
    if (config.app.env === 'production') {
      throw new Error(`Missing required configuration: ${missing.join(', ')}`);
    }
  }
}

export default config;
export { config };