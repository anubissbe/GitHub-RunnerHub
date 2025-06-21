# GitHub-RunnerHub Backup and Disaster Recovery

This document provides comprehensive information about the backup and disaster recovery system for GitHub-RunnerHub.

## Table of Contents

1. [Overview](#overview)
2. [Backup Components](#backup-components)
3. [Backup Types](#backup-types)
4. [Automated Scheduling](#automated-scheduling)
5. [Disaster Recovery](#disaster-recovery)
6. [Configuration](#configuration)
7. [Testing](#testing)
8. [Monitoring](#monitoring)
9. [Troubleshooting](#troubleshooting)

## Overview

The GitHub-RunnerHub backup and disaster recovery system provides comprehensive data protection for all critical components:

- **PostgreSQL Database**: Complete database backups with point-in-time recovery
- **Redis Data**: Job queue and session data backup
- **Configuration Files**: All system configurations and secrets
- **Docker Volumes**: Persistent application data
- **Runner States**: Active runner configurations and data
- **Application Logs**: System and application logs

### Backup Strategy

- **3-2-1 Rule**: 3 copies of data, 2 different media types, 1 offsite
- **Automated Scheduling**: Regular backups without manual intervention
- **Incremental Backups**: Efficient storage usage with frequent incremental backups
- **Disaster Recovery Testing**: Regular automated testing of recovery procedures

## Backup Components

### 1. PostgreSQL Database Backup

**Location**: `/backup/postgres/`

**Contents**:
- Full database dumps (weekly)
- Individual table backups for faster partial recovery
- Transaction log backups for point-in-time recovery
- Schema-only backups for structure recovery

**Features**:
- Compressed backups to save space
- Checksum verification for integrity
- Parallel backup jobs for performance
- Lock-free backups to avoid downtime

### 2. Redis Data Backup

**Location**: `/backup/redis/`

**Contents**:
- RDB snapshots (persistent snapshots)
- AOF (Append Only File) for durability
- Real-time data export in JSON format

**Features**:
- Automated BGSAVE triggering
- Persistence configuration optimization
- Memory-efficient backup process

### 3. Configuration Backup

**Location**: `/backup/configs/`

**Contents**:
- Docker Compose files
- Application configurations
- Environment variables (sanitized)
- Nginx configurations
- Scripts and hooks
- Vault secrets (encrypted)

**Features**:
- Version-controlled configuration tracking
- Encrypted sensitive data storage
- Complete environment recreation capability

### 4. Docker Volumes Backup

**Location**: `/backup/docker/`

**Contents**:
- All named Docker volumes
- Persistent application data
- Database storage volumes
- Log volumes

**Features**:
- Live volume backup without stopping services
- Incremental volume changes
- Cross-platform compatibility

### 5. Runner States Backup

**Location**: `/backup/runners/`

**Contents**:
- Runner container exports
- Runner metadata and configuration
- Runner working directories
- Active job states

**Features**:
- Container state preservation
- Rapid runner recreation
- Job continuity support

## Backup Types

### Full System Backup

**Schedule**: Weekly (Sunday 2 AM)
**Duration**: 30-60 minutes
**Storage**: ~2-5 GB compressed

Includes all components and provides complete system restoration capability.

```bash
# Manual full backup
./backup/scripts/backup-manager.sh
```

### Incremental PostgreSQL Backup

**Schedule**: Every 6 hours
**Duration**: 2-5 minutes
**Storage**: ~10-100 MB per backup

Captures database changes since last backup.

```bash
# Manual PostgreSQL backup
./backup/scripts/backup-manager.sh postgres
```

### Redis Backup

**Schedule**: Every 2 hours
**Duration**: 1-2 minutes
**Storage**: ~5-50 MB per backup

Backs up job queue and session data.

```bash
# Manual Redis backup
./backup/scripts/backup-manager.sh redis
```

### Configuration Backup

**Schedule**: Daily (1 AM)
**Duration**: 30 seconds
**Storage**: ~1-5 MB per backup

Backs up all configuration files.

```bash
# Manual configuration backup
./backup/scripts/backup-manager.sh configs
```

## Automated Scheduling

### Installation

Install automated backup schedules:

```bash
cd /opt/projects/projects/GitHub-RunnerHub
./backup/scripts/backup-scheduler.sh install
```

### Schedule Overview

| Backup Type | Schedule | Retention |
|-------------|----------|-----------|
| Full System | Weekly (Sunday 2 AM) | 4 weeks |
| PostgreSQL Incremental | Every 6 hours | 1 week |
| Redis | Every 2 hours | 3 days |
| Configuration | Daily (1 AM) | 2 weeks |
| Log Cleanup | Weekly (Monday 3 AM) | 1 week |
| DR Test | Monthly (1st, 4 AM) | 3 months |

### Management Commands

```bash
# Show current schedules
./backup/scripts/backup-scheduler.sh show

# Test schedule configuration
./backup/scripts/backup-scheduler.sh test

# Monitor backup status
./backup/scripts/backup-scheduler.sh monitor

# Generate backup report
./backup/scripts/backup-scheduler.sh report

# Remove all schedules
./backup/scripts/backup-scheduler.sh remove
```

## Disaster Recovery

### Recovery Scenarios

1. **Complete System Loss**: Full system restoration from backup
2. **Database Corruption**: PostgreSQL restoration with point-in-time recovery
3. **Configuration Loss**: Configuration files restoration
4. **Partial Component Failure**: Individual component restoration

### Recovery Procedures

#### Full System Recovery

```bash
# 1. List available backups
./backup/scripts/restore-manager.sh list

# 2. Perform full system restore
./backup/scripts/restore-manager.sh restore 20240621_020000

# 3. Verify system integrity
./backup/scripts/disaster-recovery-test.sh
```

#### Partial Component Recovery

```bash
# Restore only PostgreSQL
./backup/scripts/restore-manager.sh partial 20240621_020000 postgres

# Restore only Redis
./backup/scripts/restore-manager.sh partial 20240621_020000 redis

# Restore only configurations
./backup/scripts/restore-manager.sh partial 20240621_020000 configs
```

### Recovery Time Objectives (RTO)

| Component | RTO Target | Actual Performance |
|-----------|------------|-------------------|
| Full System | < 2 hours | ~45 minutes |
| PostgreSQL | < 30 minutes | ~15 minutes |
| Redis | < 10 minutes | ~5 minutes |
| Configuration | < 5 minutes | ~2 minutes |

### Recovery Point Objectives (RPO)

| Component | RPO Target | Backup Frequency |
|-----------|------------|------------------|
| PostgreSQL | < 6 hours | Every 6 hours |
| Redis | < 2 hours | Every 2 hours |
| Configuration | < 24 hours | Daily |
| Logs | < 1 week | Weekly |

## Configuration

### Main Configuration Files

1. **`backup/config/postgres-backup.conf`**: PostgreSQL backup settings
2. **`backup/config/redis-persistence.conf`**: Redis persistence configuration
3. **`backup/config/backup-schedule.conf`**: Automated scheduling configuration

### Environment Variables

Set these variables in your environment or `.env` file:

```bash
# Backup directories
BACKUP_ROOT=/mnt/synology/github-runnerhub-backups
BACKUP_RETENTION_DAYS=30

# Synology NAS settings
SYNOLOGY_HOST=YOUR_SERVER_IP
SYNOLOGY_USER=Bert
SYNOLOGY_SSH_PORT=2222
SYNOLOGY_BACKUP_PATH=/volume1/backup/github-runnerhub

# Database settings
DB_USER=runnerhub
DB_PASSWORD=runnerhub_secure_2024
DB_NAME=github_runnerhub
DB_HOST=localhost
DB_PORT=5432

# Redis settings
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# Notification settings
SLACK_WEBHOOK_URL=https://hooks.slack.com/...
```

### Custom Configuration

Modify backup behavior by editing configuration files:

```bash
# Edit PostgreSQL backup settings
nano backup/config/postgres-backup.conf

# Edit Redis persistence settings
nano backup/config/redis-persistence.conf

# Edit backup schedule
nano backup/config/backup-schedule.conf
```

## Testing

### Automated Testing

The system includes comprehensive disaster recovery testing:

```bash
# Run full disaster recovery test
./backup/scripts/disaster-recovery-test.sh

# View test results
cat backup/test-results/dr-test-report-*.md
```

### Test Coverage

- ✅ Backup script functionality
- ✅ PostgreSQL backup and restore
- ✅ Redis backup and restore
- ✅ Configuration backup and restore
- ✅ Backup integrity verification
- ✅ Disaster recovery procedures
- ✅ Backup rotation and cleanup
- ✅ Recovery time objectives

### Manual Testing

1. **Create Test Data**:
   ```bash
   # Create test records in database
   psql $DATABASE_URL -c "INSERT INTO test_table VALUES (1, 'test');"
   
   # Create test Redis data
   redis-cli SET test:key "test_value"
   ```

2. **Perform Backup**:
   ```bash
   ./backup/scripts/backup-manager.sh
   ```

3. **Simulate Disaster**:
   ```bash
   # Drop test data
   psql $DATABASE_URL -c "DROP TABLE test_table;"
   redis-cli DEL test:key
   ```

4. **Restore and Verify**:
   ```bash
   ./backup/scripts/restore-manager.sh restore [timestamp]
   # Verify data is restored
   ```

## Monitoring

### Backup Monitoring

Monitor backup operations through multiple channels:

1. **Log Files**: `/var/log/runnerhub-backup.log`
2. **Slack Notifications**: Automated success/failure notifications
3. **Email Alerts**: Critical backup failures
4. **Dashboard Metrics**: Grafana backup status dashboard

### Key Metrics

- Backup success/failure rate
- Backup duration trends
- Storage usage growth
- Recovery time performance
- Data integrity verification results

### Alerting Rules

| Condition | Alert Level | Action |
|-----------|-------------|---------|
| Backup failure | Critical | Immediate notification |
| Backup duration > 2x normal | Warning | Investigation required |
| Storage usage > 80% | Warning | Cleanup required |
| No backup in 25 hours | Critical | Manual intervention |
| Verification failure | Critical | Immediate investigation |

### Monitoring Commands

```bash
# Check backup status
./backup/scripts/backup-scheduler.sh monitor

# View recent backup activity
tail -f /var/log/runnerhub-backup.log

# Generate status report
./backup/scripts/backup-scheduler.sh report
```

## Troubleshooting

### Common Issues

#### 1. Backup Fails with "No space left on device"

**Solution**:
```bash
# Check disk usage
df -h

# Clean old backups
find /backup -name "*.tar.gz" -mtime +30 -delete

# Increase backup retention period
export BACKUP_RETENTION_DAYS=15
```

#### 2. PostgreSQL backup hangs

**Solution**:
```bash
# Check for long-running transactions
psql $DATABASE_URL -c "SELECT * FROM pg_stat_activity WHERE state = 'active';"

# Terminate blocking queries if safe
psql $DATABASE_URL -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE state = 'active' AND query_start < NOW() - INTERVAL '1 hour';"
```

#### 3. Redis backup fails

**Solution**:
```bash
# Check Redis connectivity
redis-cli ping

# Check Redis logs
docker logs runnerhub-redis

# Manually trigger BGSAVE
redis-cli BGSAVE

# Check disk space in Redis container
docker exec runnerhub-redis df -h
```

#### 4. Synology upload fails

**Solution**:
```bash
# Test SSH connectivity
ssh -p 2222 Bert@YOUR_SERVER_IP

# Check Synology disk space
ssh -p 2222 Bert@YOUR_SERVER_IP "df -h"

# Test rsync manually
rsync -avz --progress -e "ssh -p 2222" /local/backup/ Bert@YOUR_SERVER_IP:/volume1/backup/github-runnerhub/
```

#### 5. Restore verification fails

**Solution**:
```bash
# Check backup file integrity
sha256sum -c backup/metadata/checksums.txt

# Verify database connectivity
psql $DATABASE_URL -c "SELECT 1;"

# Check service status
docker-compose ps
```

### Debug Mode

Enable debug mode for detailed troubleshooting:

```bash
# Enable debug logging
export DEBUG_MODE=yes
export VERBOSE_LOGGING=yes

# Run backup with debug output
./backup/scripts/backup-manager.sh 2>&1 | tee debug.log
```

### Log Analysis

Analyze backup logs for issues:

```bash
# Search for errors
grep -i error /var/log/runnerhub-backup.log

# Search for warnings
grep -i warn /var/log/runnerhub-backup.log

# Analyze backup duration trends
grep "completed successfully" /var/log/runnerhub-backup.log | awk '{print $1, $2, $NF}'
```

### Support Information

When requesting support, provide:

1. **System Information**:
   ```bash
   uname -a
   docker --version
   docker-compose --version
   ```

2. **Backup Configuration**:
   ```bash
   cat backup/config/*.conf
   crontab -l | grep -E "(backup|runnerhub)"
   ```

3. **Recent Logs**:
   ```bash
   tail -100 /var/log/runnerhub-backup.log
   ```

4. **System Status**:
   ```bash
   docker-compose ps
   df -h
   free -h
   ```

## Best Practices

1. **Regular Testing**: Test disaster recovery procedures monthly
2. **Monitor Storage**: Keep backup storage usage under 80%
3. **Verify Integrity**: Always verify backup integrity after creation
4. **Document Changes**: Keep backup procedures documentation updated
5. **Security**: Encrypt sensitive backups and use secure transport
6. **Automation**: Minimize manual intervention through automation
7. **Monitoring**: Set up proactive monitoring and alerting
8. **Training**: Ensure team members know recovery procedures

## Security Considerations

1. **Encryption**: All backups containing sensitive data are encrypted
2. **Access Control**: Backup files have restricted permissions (600/700)
3. **Transport Security**: Remote transfers use SSH/TLS encryption
4. **Secret Management**: Database passwords stored in Vault
5. **Audit Trail**: All backup operations are logged
6. **Network Security**: Backup traffic isolated on secure networks

---

For additional support or questions, refer to the project documentation or create an issue in the GitHub repository.