# Production Deployment Guide 🚀

Comprehensive guide for deploying GitHub-RunnerHub v2.0.0 in production environments with high availability, security hardening, and monitoring.

## 📋 Prerequisites

### System Requirements

#### Minimum Requirements (Single Node)
- **CPU**: 4 cores
- **RAM**: 8 GB
- **Storage**: 100 GB SSD
- **Network**: 100 Mbps
- **OS**: Ubuntu 20.04+ or RHEL 8+

#### Recommended Requirements (Production)
- **CPU**: 8+ cores
- **RAM**: 16+ GB
- **Storage**: 500 GB SSD
- **Network**: 1 Gbps
- **OS**: Ubuntu 22.04 LTS

#### High Availability Requirements (3+ Nodes)
- **Per Node**: 8 cores, 16 GB RAM, 200 GB SSD
- **Load Balancer**: HAProxy or cloud load balancer
- **Shared Storage**: NFS or cloud storage
- **Database**: PostgreSQL with replication

### Software Prerequisites
- Docker 20.10+
- Docker Compose 2.0+
- PostgreSQL 14+ (external or containerized)
- Redis 7+ (external or containerized)
- Nginx or HAProxy (for reverse proxy)
- SSL certificates (Let's Encrypt or commercial)

## 🏗️ Architecture Overview

### Single Node Architecture
```
┌─────────────────────────────────────────────┐
│                Load Balancer                 │
│              (Nginx/HAProxy)                 │
└─────────────────────┬───────────────────────┘
                      │
┌─────────────────────┴───────────────────────┐
│              RunnerHub Node                  │
│  ┌─────────┐ ┌─────────┐ ┌─────────────┐  │
│  │   App   │ │  Redis  │ │  PostgreSQL │  │
│  └─────────┘ └─────────┘ └─────────────┘  │
│  ┌─────────────────────────────────────┐   │
│  │         Docker Containers           │   │
│  └─────────────────────────────────────┘   │
└─────────────────────────────────────────────┘
```

### High Availability Architecture
```
┌─────────────────────────────────────────────┐
│          Load Balancer (Active/Passive)      │
└──────┬──────────────┬──────────────┬────────┘
       │              │              │
┌──────┴────┐  ┌──────┴────┐  ┌──────┴────┐
│  Node 1   │  │  Node 2   │  │  Node 3   │
│ (Active)  │  │ (Active)  │  │ (Active)  │
└─────┬─────┘  └─────┬─────┘  └─────┬─────┘
      │              │              │
┌─────┴──────────────┴──────────────┴─────┐
│         Shared Services                  │
│  ┌──────────┐  ┌──────────┐            │
│  │PostgreSQL│  │  Redis   │            │
│  │ Primary  │  │ Sentinel │            │
│  └────┬─────┘  └──────────┘            │
│       │                                 │
│  ┌────┴─────┐  ┌──────────┐           │
│  │PostgreSQL│  │  Redis   │           │
│  │ Replica  │  │  Slaves  │           │
│  └──────────┘  └──────────┘           │
└─────────────────────────────────────────┘
```

## 🔐 Security Hardening

### 1. Network Security

#### Firewall Configuration
```bash
# Allow only necessary ports
sudo ufw default deny incoming
sudo ufw default allow outgoing

# SSH (restrict to specific IPs)
sudo ufw allow from 10.0.0.0/8 to any port 22

# HTTP/HTTPS
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# Application ports (internal only)
sudo ufw allow from 10.0.0.0/8 to any port 3001
sudo ufw allow from 10.0.0.0/8 to any port 5432
sudo ufw allow from 10.0.0.0/8 to any port 6379

# Monitoring ports (internal only)
sudo ufw allow from 10.0.0.0/8 to any port 9090
sudo ufw allow from 10.0.0.0/8 to any port 3002

# Enable firewall
sudo ufw enable
```

#### SELinux Configuration (RHEL/CentOS)
```bash
# Set SELinux to enforcing mode
sudo setenforce 1
sudo sed -i 's/SELINUX=permissive/SELINUX=enforcing/' /etc/selinux/config

# Configure SELinux contexts for Docker
sudo setsebool -P container_manage_cgroup on
sudo setsebool -P container_use_devices on
```

### 2. SSL/TLS Configuration

#### Generate SSL Certificates with Let's Encrypt
```bash
# Install certbot
sudo apt-get update
sudo apt-get install certbot python3-certbot-nginx

# Generate certificates
sudo certbot certonly --standalone -d your-domain.com

# Auto-renewal
sudo systemctl enable certbot.timer
```

#### Nginx SSL Configuration
```nginx
server {
    listen 443 ssl http2;
    server_name your-domain.com;

    # SSL Configuration
    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;
    
    # SSL Security
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers 'ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384';
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;
    ssl_stapling on;
    ssl_stapling_verify on;
    
    # Security Headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options "DENY" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';" always;
    
    # Rate Limiting
    limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;
    limit_req zone=api burst=20 nodelay;
    
    # Proxy to RunnerHub
    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }
}

# Redirect HTTP to HTTPS
server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$server_name$request_uri;
}
```

### 3. Environment Variables Security

Create secure environment file:
```bash
# Generate strong secrets
JWT_SECRET=$(openssl rand -base64 32)
ENCRYPTION_KEY=$(openssl rand -hex 16)
POSTGRES_PASSWORD=$(openssl rand -base64 24)
REDIS_PASSWORD=$(openssl rand -base64 24)
GITHUB_WEBHOOK_SECRET=$(openssl rand -base64 32)

# Create .env file with restricted permissions
cat > /opt/runnerhub/.env << EOF
# Production Environment Variables
NODE_ENV=production

# GitHub Integration
GITHUB_TOKEN=${GITHUB_TOKEN}
GITHUB_ORG=${GITHUB_ORG}
GITHUB_WEBHOOK_SECRET=${GITHUB_WEBHOOK_SECRET}

# Database
DATABASE_URL=postgresql://runnerhub:${POSTGRES_PASSWORD}@postgres:5432/runnerhub
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}

# Redis
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=${REDIS_PASSWORD}

# Security
JWT_SECRET=${JWT_SECRET}
ENCRYPTION_KEY=${ENCRYPTION_KEY}
SECURITY_LEVEL=high
ENABLE_SECURITY_SCANNING=true
ENABLE_AUDIT_LOGGING=true

# Performance
ENABLE_AI_OPTIMIZATION=true
CONTAINER_POOL_SIZE=20
MAX_CONCURRENT_JOBS=100

# Monitoring
PROMETHEUS_ENABLED=true
GRAFANA_ENABLED=true
LOG_LEVEL=info
EOF

# Secure permissions
chmod 600 /opt/runnerhub/.env
chown runnerhub:runnerhub /opt/runnerhub/.env
```

## 🚀 Deployment Steps

### Step 1: System Preparation

```bash
# Update system
sudo apt-get update
sudo apt-get upgrade -y

# Install dependencies
sudo apt-get install -y \
    apt-transport-https \
    ca-certificates \
    curl \
    gnupg \
    lsb-release \
    git \
    jq

# Install Docker
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# Create dedicated user
sudo useradd -r -s /bin/bash -d /opt/runnerhub runnerhub
sudo usermod -aG docker runnerhub
sudo mkdir -p /opt/runnerhub
sudo chown -R runnerhub:runnerhub /opt/runnerhub
```

### Step 2: Clone and Configure

```bash
# Switch to runnerhub user
sudo su - runnerhub

# Clone repository
git clone https://github.com/anubissbe/GitHub-RunnerHub.git
cd GitHub-RunnerHub
git checkout v2.0.0

# Copy production files
cp docker-compose.production.yml docker-compose.yml
cp Dockerfile.production Dockerfile

# Create required directories
mkdir -p logs ssl backup data
```

### Step 3: Database Setup

#### PostgreSQL Configuration
```bash
# Create PostgreSQL configuration
cat > config/postgresql.conf << EOF
# Performance Tuning
shared_buffers = 2GB
effective_cache_size = 6GB
maintenance_work_mem = 512MB
checkpoint_completion_target = 0.9
wal_buffers = 16MB
default_statistics_target = 100
random_page_cost = 1.1
effective_io_concurrency = 200
work_mem = 10MB
min_wal_size = 1GB
max_wal_size = 4GB
max_worker_processes = 8
max_parallel_workers_per_gather = 4
max_parallel_workers = 8

# Security
ssl = on
ssl_cert_file = '/etc/ssl/certs/ssl-cert-snakeoil.pem'
ssl_key_file = '/etc/ssl/private/ssl-cert-snakeoil.key'

# Logging
log_destination = 'stderr'
logging_collector = on
log_directory = 'pg_log'
log_filename = 'postgresql-%Y-%m-%d_%H%M%S.log'
log_statement = 'mod'
log_min_duration_statement = 100

# Replication (for HA)
wal_level = replica
max_wal_senders = 3
max_replication_slots = 3
hot_standby = on
EOF
```

#### Initialize Database
```bash
# Start only PostgreSQL
docker-compose up -d postgres

# Wait for PostgreSQL to be ready
sleep 10

# Run migrations
docker-compose run --rm runnerhub npm run migrate

# Verify database
docker-compose exec postgres psql -U runnerhub -d runnerhub -c "\dt"
```

### Step 4: Start Services

```bash
# Start all services
docker-compose up -d

# Check service status
docker-compose ps

# View logs
docker-compose logs -f
```

### Step 5: Health Verification

```bash
# Check application health
curl -f http://localhost:3001/health

# Check metrics endpoint
curl -H "Authorization: Bearer $JWT_TOKEN" http://localhost:3001/api/metrics

# Check database connectivity
docker-compose exec postgres pg_isready -U runnerhub

# Check Redis connectivity
docker-compose exec redis redis-cli ping
```

## 🏗️ High Availability Setup

### PostgreSQL Replication

#### Primary Server Configuration
```bash
# On primary server
docker-compose exec postgres psql -U postgres << EOF
CREATE USER replicator WITH REPLICATION ENCRYPTED PASSWORD 'secure_replication_password';
EOF

# Configure pg_hba.conf
echo "host replication replicator 10.0.0.0/8 md5" >> config/pg_hba.conf
```

#### Replica Server Configuration
```bash
# On replica server
# Stop PostgreSQL
docker-compose stop postgres

# Backup from primary
pg_basebackup -h primary-server -D /var/lib/postgresql/data -U replicator -v -P -W

# Create standby.signal
touch /var/lib/postgresql/data/standby.signal

# Configure postgresql.conf
echo "primary_conninfo = 'host=primary-server port=5432 user=replicator password=secure_replication_password'" >> config/postgresql.conf

# Start replica
docker-compose start postgres
```

### Redis Sentinel Setup

```yaml
# redis-sentinel.conf
port 26379
sentinel monitor mymaster redis-master 6379 2
sentinel auth-pass mymaster your_redis_password
sentinel down-after-milliseconds mymaster 5000
sentinel parallel-syncs mymaster 1
sentinel failover-timeout mymaster 10000
```

### Load Balancer Configuration

#### HAProxy Configuration
```
global
    maxconn 4096
    log 127.0.0.1 local0
    chroot /var/lib/haproxy
    stats socket /run/haproxy/admin.sock mode 660 level admin
    stats timeout 30s
    user haproxy
    group haproxy
    daemon

defaults
    log     global
    mode    http
    option  httplog
    option  dontlognull
    timeout connect 5000
    timeout client  50000
    timeout server  50000
    errorfile 503 /etc/haproxy/errors/503.http

frontend runnerhub_frontend
    bind *:80
    bind *:443 ssl crt /etc/ssl/certs/runnerhub.pem
    redirect scheme https if !{ ssl_fc }
    
    # Security headers
    rspadd Strict-Transport-Security:\ max-age=31536000;\ includeSubDomains
    rspadd X-Frame-Options:\ DENY
    rspadd X-Content-Type-Options:\ nosniff
    
    default_backend runnerhub_backend

backend runnerhub_backend
    balance roundrobin
    option httpchk GET /health
    
    server node1 10.0.1.10:3001 check
    server node2 10.0.1.11:3001 check
    server node3 10.0.1.12:3001 check

listen stats
    bind *:8080
    stats enable
    stats uri /stats
    stats realm Haproxy\ Statistics
    stats auth admin:secure_password
```

## 📊 Monitoring Setup

### Prometheus Configuration

```yaml
# prometheus.yml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

alerting:
  alertmanagers:
    - static_configs:
        - targets:
          - alertmanager:9093

rule_files:
  - "alerts/*.yml"

scrape_configs:
  - job_name: 'runnerhub'
    static_configs:
      - targets: ['runnerhub:3001']
    metrics_path: '/metrics'
    
  - job_name: 'node-exporter'
    static_configs:
      - targets: ['node-exporter:9100']
      
  - job_name: 'postgres-exporter'
    static_configs:
      - targets: ['postgres-exporter:9187']
      
  - job_name: 'redis-exporter'
    static_configs:
      - targets: ['redis-exporter:9121']
```

### Alert Rules

```yaml
# alerts/runnerhub.yml
groups:
  - name: runnerhub
    rules:
      - alert: HighCPUUsage
        expr: rate(process_cpu_seconds_total[5m]) > 0.8
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "High CPU usage detected"
          description: "CPU usage is above 80% for more than 10 minutes"
          
      - alert: HighMemoryUsage
        expr: process_resident_memory_bytes / node_memory_MemTotal_bytes > 0.8
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "High memory usage detected"
          description: "Memory usage is above 80% for more than 10 minutes"
          
      - alert: DatabaseDown
        expr: up{job="postgres-exporter"} == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "PostgreSQL is down"
          description: "PostgreSQL database is not responding"
          
      - alert: HighJobFailureRate
        expr: rate(job_failed_total[5m]) > 0.1
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High job failure rate"
          description: "More than 10% of jobs are failing"
```

### Grafana Dashboards

Import pre-configured dashboards:
```bash
# Copy dashboard configurations
cp config/grafana/dashboards/*.json /var/lib/grafana/dashboards/

# Restart Grafana
docker-compose restart grafana
```

## 🔄 Backup & Recovery

### Automated Backup Script

```bash
#!/bin/bash
# backup.sh

BACKUP_DIR="/backup/runnerhub"
DATE=$(date +%Y%m%d_%H%M%S)
RETENTION_DAYS=30

# Create backup directory
mkdir -p ${BACKUP_DIR}/${DATE}

# Backup database
docker-compose exec -T postgres pg_dump -U runnerhub runnerhub | gzip > ${BACKUP_DIR}/${DATE}/database.sql.gz

# Backup Redis
docker-compose exec -T redis redis-cli --raw BGSAVE
sleep 5
docker cp $(docker-compose ps -q redis):/data/dump.rdb ${BACKUP_DIR}/${DATE}/redis.rdb

# Backup configuration
tar -czf ${BACKUP_DIR}/${DATE}/config.tar.gz .env config/

# Backup logs
tar -czf ${BACKUP_DIR}/${DATE}/logs.tar.gz logs/

# Remove old backups
find ${BACKUP_DIR} -type d -mtime +${RETENTION_DAYS} -exec rm -rf {} \;

echo "Backup completed: ${BACKUP_DIR}/${DATE}"
```

### Recovery Procedure

```bash
# Restore database
gunzip -c /backup/runnerhub/20240623_120000/database.sql.gz | docker-compose exec -T postgres psql -U runnerhub runnerhub

# Restore Redis
docker cp /backup/runnerhub/20240623_120000/redis.rdb $(docker-compose ps -q redis):/data/dump.rdb
docker-compose restart redis

# Restore configuration
tar -xzf /backup/runnerhub/20240623_120000/config.tar.gz
```

## 🚨 Maintenance & Operations

### Log Rotation

```bash
# /etc/logrotate.d/runnerhub
/opt/runnerhub/logs/*.log {
    daily
    rotate 30
    compress
    delaycompress
    notifempty
    create 0640 runnerhub runnerhub
    sharedscripts
    postrotate
        docker-compose restart runnerhub > /dev/null 2>&1 || true
    endscript
}
```

### Health Checks

```bash
# health-check.sh
#!/bin/bash

# Check all services
for service in runnerhub postgres redis prometheus grafana; do
    if ! docker-compose ps | grep -q "${service}.*Up"; then
        echo "ERROR: ${service} is not running"
        exit 1
    fi
done

# Check API health
if ! curl -sf http://localhost:3001/health > /dev/null; then
    echo "ERROR: API health check failed"
    exit 1
fi

echo "All services are healthy"
```

### Update Procedure

```bash
# 1. Backup current state
./backup.sh

# 2. Pull latest version
git fetch --tags
git checkout v2.1.0

# 3. Update dependencies
docker-compose build --no-cache

# 4. Run migrations
docker-compose run --rm runnerhub npm run migrate

# 5. Rolling update
docker-compose up -d --no-deps --scale runnerhub=2 runnerhub
sleep 30
docker-compose up -d --no-deps runnerhub

# 6. Verify
./health-check.sh
```

## 📈 Performance Tuning

### System Tuning

```bash
# /etc/sysctl.conf
# Network optimizations
net.core.somaxconn = 65535
net.ipv4.tcp_max_syn_backlog = 65535
net.ipv4.ip_local_port_range = 1024 65535
net.ipv4.tcp_tw_reuse = 1
net.ipv4.tcp_fin_timeout = 15
net.core.netdev_max_backlog = 16384

# Memory optimizations
vm.swappiness = 10
vm.dirty_ratio = 15
vm.dirty_background_ratio = 5

# File system optimizations
fs.file-max = 2097152
fs.inotify.max_user_watches = 524288

# Apply settings
sudo sysctl -p
```

### Docker Optimization

```json
// /etc/docker/daemon.json
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "100m",
    "max-file": "5"
  },
  "storage-driver": "overlay2",
  "storage-opts": [
    "overlay2.override_kernel_check=true"
  ],
  "dns": ["8.8.8.8", "8.8.4.4"],
  "max-concurrent-downloads": 10,
  "max-concurrent-uploads": 10,
  "default-ulimits": {
    "nofile": {
      "Name": "nofile",
      "Hard": 64000,
      "Soft": 64000
    }
  }
}
```

## 🔍 Troubleshooting

### Common Issues

#### Container Won't Start
```bash
# Check logs
docker-compose logs runnerhub

# Check resource usage
docker system df
docker system prune -a

# Verify environment variables
docker-compose config
```

#### Database Connection Issues
```bash
# Test connection
docker-compose exec runnerhub nc -zv postgres 5432

# Check PostgreSQL logs
docker-compose logs postgres

# Verify credentials
docker-compose exec postgres psql -U runnerhub -c "SELECT 1"
```

#### Performance Issues
```bash
# Check container stats
docker stats

# Analyze slow queries
docker-compose exec postgres psql -U runnerhub -c "SELECT * FROM pg_stat_statements ORDER BY total_time DESC LIMIT 10"

# Check Redis memory
docker-compose exec redis redis-cli INFO memory
```

## 📋 Production Checklist

### Pre-Production
- [ ] SSL certificates configured
- [ ] Firewall rules applied
- [ ] Security headers configured
- [ ] Environment variables secured
- [ ] Backup strategy implemented
- [ ] Monitoring configured
- [ ] Alert rules defined
- [ ] Log rotation configured
- [ ] Health checks automated
- [ ] Documentation updated

### Go-Live
- [ ] All services running
- [ ] Health checks passing
- [ ] Monitoring active
- [ ] Backups tested
- [ ] Security scan completed
- [ ] Performance baseline established
- [ ] Incident response plan ready
- [ ] Team trained
- [ ] Support channels ready
- [ ] Rollback plan prepared

## 🆘 Support & Resources

### Emergency Contacts
- **On-Call Engineer**: [your-oncall@company.com](mailto:your-oncall@company.com)
- **Security Team**: [security@company.com](mailto:security@company.com)
- **Database Admin**: [dba@company.com](mailto:dba@company.com)

### Resources
- **Monitoring Dashboard**: https://monitoring.your-domain.com
- **Log Aggregation**: https://logs.your-domain.com
- **Wiki**: [GitHub-RunnerHub Wiki](https://github.com/anubissbe/GitHub-RunnerHub/wiki)
- **Support**: [GitHub Issues](https://github.com/anubissbe/GitHub-RunnerHub/issues)

---

**🚀 Successfully deployed? Check our [Post-Deployment Guide](Post-Deployment-Guide)**

**🏠 Back to: [Wiki Home](Home)**