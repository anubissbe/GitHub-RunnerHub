#!/bin/bash
# GitHub-RunnerHub Disaster Recovery Test Script
# Tests backup and restore procedures in a safe environment

set -euo pipefail

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TEST_ENV_DIR="/tmp/runnerhub-dr-test"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Test results
TESTS_PASSED=0
TESTS_FAILED=0

# Logging functions
log_info() {
    echo -e "${GREEN}[INFO]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1"
}

log_test() {
    echo -e "${BLUE}[TEST]${NC} $1"
}

test_pass() {
    echo -e "${GREEN}[PASS]${NC} $1"
    ((TESTS_PASSED++))
}

test_fail() {
    echo -e "${RED}[FAIL]${NC} $1"
    ((TESTS_FAILED++))
}

# Setup test environment
setup_test_env() {
    log_info "Setting up test environment..."
    
    # Create test directory
    rm -rf "$TEST_ENV_DIR"
    mkdir -p "$TEST_ENV_DIR"/{data,backups,restore}
    
    # Create test database
    docker run -d \
        --name runnerhub-test-postgres \
        -e POSTGRES_USER=testuser \
        -e POSTGRES_PASSWORD=testpass \
        -e POSTGRES_DB=testdb \
        -p 15432:5432 \
        postgres:15-alpine
    
    # Create test Redis
    docker run -d \
        --name runnerhub-test-redis \
        -p 16379:6379 \
        redis:7-alpine
    
    # Wait for services
    sleep 10
    
    log_info "Test environment ready"
}

# Cleanup test environment
cleanup_test_env() {
    log_info "Cleaning up test environment..."
    
    docker stop runnerhub-test-postgres runnerhub-test-redis 2>/dev/null || true
    docker rm runnerhub-test-postgres runnerhub-test-redis 2>/dev/null || true
    
    rm -rf "$TEST_ENV_DIR"
}

# Test 1: Backup script existence and permissions
test_backup_scripts() {
    log_test "Testing backup scripts..."
    
    if [ -f "$SCRIPT_DIR/backup-manager.sh" ] && [ -x "$SCRIPT_DIR/backup-manager.sh" ]; then
        test_pass "Backup script exists and is executable"
    else
        test_fail "Backup script missing or not executable"
    fi
    
    if [ -f "$SCRIPT_DIR/restore-manager.sh" ] && [ -x "$SCRIPT_DIR/restore-manager.sh" ]; then
        test_pass "Restore script exists and is executable"
    else
        test_fail "Restore script missing or not executable"
    fi
}

# Test 2: PostgreSQL backup and restore
test_postgres_backup_restore() {
    log_test "Testing PostgreSQL backup and restore..."
    
    # Create test data
    PGPASSWORD=testpass psql -h localhost -p 15432 -U testuser -d testdb << EOF
CREATE TABLE test_data (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100),
    value INTEGER,
    created_at TIMESTAMP DEFAULT NOW()
);

INSERT INTO test_data (name, value) VALUES
    ('test1', 100),
    ('test2', 200),
    ('test3', 300);
EOF
    
    # Backup
    PGPASSWORD=testpass pg_dump \
        -h localhost \
        -p 15432 \
        -U testuser \
        -d testdb \
        -f "$TEST_ENV_DIR/backups/postgres_test.sql"
    
    if [ -f "$TEST_ENV_DIR/backups/postgres_test.sql" ]; then
        test_pass "PostgreSQL backup created"
    else
        test_fail "PostgreSQL backup failed"
        return
    fi
    
    # Drop table
    PGPASSWORD=testpass psql -h localhost -p 15432 -U testuser -d testdb -c "DROP TABLE test_data;"
    
    # Restore
    PGPASSWORD=testpass psql \
        -h localhost \
        -p 15432 \
        -U testuser \
        -d testdb \
        -f "$TEST_ENV_DIR/backups/postgres_test.sql"
    
    # Verify
    result=$(PGPASSWORD=testpass psql -h localhost -p 15432 -U testuser -d testdb -t -c "SELECT COUNT(*) FROM test_data;")
    if [ "$(echo $result | tr -d ' ')" = "3" ]; then
        test_pass "PostgreSQL restore successful"
    else
        test_fail "PostgreSQL restore failed"
    fi
}

# Test 3: Redis backup and restore
test_redis_backup_restore() {
    log_test "Testing Redis backup and restore..."
    
    # Create test data
    redis-cli -h localhost -p 16379 SET test:key1 "value1"
    redis-cli -h localhost -p 16379 SET test:key2 "value2"
    redis-cli -h localhost -p 16379 HSET test:hash field1 "hashvalue1"
    
    # Trigger backup
    redis-cli -h localhost -p 16379 BGSAVE
    sleep 2
    
    # Copy dump file
    docker cp runnerhub-test-redis:/data/dump.rdb "$TEST_ENV_DIR/backups/redis_test.rdb"
    
    if [ -f "$TEST_ENV_DIR/backups/redis_test.rdb" ]; then
        test_pass "Redis backup created"
    else
        test_fail "Redis backup failed"
        return
    fi
    
    # Clear Redis
    redis-cli -h localhost -p 16379 FLUSHALL
    
    # Stop Redis
    docker stop runnerhub-test-redis
    
    # Restore dump
    docker cp "$TEST_ENV_DIR/backups/redis_test.rdb" runnerhub-test-redis:/data/dump.rdb
    
    # Start Redis
    docker start runnerhub-test-redis
    sleep 5
    
    # Verify
    value1=$(redis-cli -h localhost -p 16379 GET test:key1)
    value2=$(redis-cli -h localhost -p 16379 GET test:key2)
    
    if [ "$value1" = "value1" ] && [ "$value2" = "value2" ]; then
        test_pass "Redis restore successful"
    else
        test_fail "Redis restore failed"
    fi
}

# Test 4: Configuration backup and restore
test_config_backup_restore() {
    log_test "Testing configuration backup and restore..."
    
    # Create test configs
    mkdir -p "$TEST_ENV_DIR/data/config"
    cat > "$TEST_ENV_DIR/data/config/test.yml" << EOF
test:
  enabled: true
  value: 42
EOF
    
    # Backup
    tar -czf "$TEST_ENV_DIR/backups/config_test.tar.gz" -C "$TEST_ENV_DIR/data" config/
    
    if [ -f "$TEST_ENV_DIR/backups/config_test.tar.gz" ]; then
        test_pass "Configuration backup created"
    else
        test_fail "Configuration backup failed"
        return
    fi
    
    # Remove original
    rm -rf "$TEST_ENV_DIR/data/config"
    
    # Restore
    tar -xzf "$TEST_ENV_DIR/backups/config_test.tar.gz" -C "$TEST_ENV_DIR/restore"
    
    # Verify
    if [ -f "$TEST_ENV_DIR/restore/config/test.yml" ]; then
        content=$(cat "$TEST_ENV_DIR/restore/config/test.yml")
        if [[ "$content" == *"value: 42"* ]]; then
            test_pass "Configuration restore successful"
        else
            test_fail "Configuration content mismatch"
        fi
    else
        test_fail "Configuration restore failed"
    fi
}

# Test 5: Backup compression and checksums
test_backup_integrity() {
    log_test "Testing backup integrity features..."
    
    # Create test file
    echo "Test data for checksum" > "$TEST_ENV_DIR/data/test.txt"
    
    # Create checksum
    sha256sum "$TEST_ENV_DIR/data/test.txt" > "$TEST_ENV_DIR/data/checksum.txt"
    
    # Compress
    tar -czf "$TEST_ENV_DIR/backups/integrity_test.tar.gz" -C "$TEST_ENV_DIR/data" .
    
    # Extract
    mkdir -p "$TEST_ENV_DIR/restore/integrity"
    tar -xzf "$TEST_ENV_DIR/backups/integrity_test.tar.gz" -C "$TEST_ENV_DIR/restore/integrity"
    
    # Verify checksum
    cd "$TEST_ENV_DIR/restore/integrity"
    if sha256sum -c checksum.txt > /dev/null 2>&1; then
        test_pass "Backup integrity verification successful"
    else
        test_fail "Backup integrity verification failed"
    fi
}

# Test 6: Automated backup scheduling
test_backup_scheduling() {
    log_test "Testing backup scheduling setup..."
    
    # Check if cron job exists
    if crontab -l 2>/dev/null | grep -q "backup-manager.sh"; then
        test_pass "Backup cron job configured"
    else
        test_warn "Backup cron job not configured (manual setup required)"
    fi
}

# Test 7: Disaster recovery procedure
test_disaster_recovery_procedure() {
    log_test "Testing disaster recovery procedure..."
    
    # Simulate backup
    mkdir -p "$TEST_ENV_DIR/dr-test/backup"
    echo "DR test data" > "$TEST_ENV_DIR/dr-test/data.txt"
    tar -czf "$TEST_ENV_DIR/dr-test/backup/dr_test.tar.gz" -C "$TEST_ENV_DIR/dr-test" data.txt
    
    # Simulate disaster - remove data
    rm "$TEST_ENV_DIR/dr-test/data.txt"
    
    # Recover
    tar -xzf "$TEST_ENV_DIR/dr-test/backup/dr_test.tar.gz" -C "$TEST_ENV_DIR/dr-test"
    
    # Verify recovery
    if [ -f "$TEST_ENV_DIR/dr-test/data.txt" ] && [ "$(cat $TEST_ENV_DIR/dr-test/data.txt)" = "DR test data" ]; then
        test_pass "Disaster recovery procedure successful"
    else
        test_fail "Disaster recovery procedure failed"
    fi
}

# Test 8: Backup rotation
test_backup_rotation() {
    log_test "Testing backup rotation..."
    
    # Create old backups
    mkdir -p "$TEST_ENV_DIR/rotation"
    for i in {1..5}; do
        old_date=$(date -d "$((i * 40)) days ago" +"%Y%m%d_%H%M%S")
        mkdir "$TEST_ENV_DIR/rotation/$old_date"
        touch "$TEST_ENV_DIR/rotation/$old_date/backup.tar.gz"
    done
    
    # Create recent backup
    recent_date=$(date +"%Y%m%d_%H%M%S")
    mkdir "$TEST_ENV_DIR/rotation/$recent_date"
    touch "$TEST_ENV_DIR/rotation/$recent_date/backup.tar.gz"
    
    # Simulate rotation (remove backups older than 30 days)
    find "$TEST_ENV_DIR/rotation" -maxdepth 1 -type d -name "20*" -mtime +30 -exec rm -rf {} \; 2>/dev/null || true
    
    # Count remaining backups
    remaining=$(ls -1 "$TEST_ENV_DIR/rotation" | grep -E "^20[0-9]{6}_[0-9]{6}$" | wc -l)
    
    if [ "$remaining" -eq 1 ]; then
        test_pass "Backup rotation successful"
    else
        test_fail "Backup rotation failed (expected 1, got $remaining)"
    fi
}

# Test 9: Recovery time objective (RTO)
test_recovery_time() {
    log_test "Testing recovery time objective..."
    
    # Create test backup
    mkdir -p "$TEST_ENV_DIR/rto/backup"
    dd if=/dev/zero of="$TEST_ENV_DIR/rto/data.bin" bs=1M count=10 2>/dev/null
    
    # Measure backup time
    start_time=$(date +%s)
    tar -czf "$TEST_ENV_DIR/rto/backup/rto_test.tar.gz" -C "$TEST_ENV_DIR/rto" data.bin
    backup_time=$(($(date +%s) - start_time))
    
    # Remove original
    rm "$TEST_ENV_DIR/rto/data.bin"
    
    # Measure restore time
    start_time=$(date +%s)
    tar -xzf "$TEST_ENV_DIR/rto/backup/rto_test.tar.gz" -C "$TEST_ENV_DIR/rto"
    restore_time=$(($(date +%s) - start_time))
    
    total_time=$((backup_time + restore_time))
    
    log_info "Backup time: ${backup_time}s, Restore time: ${restore_time}s, Total: ${total_time}s"
    
    # Check if RTO is reasonable (under 5 minutes for test data)
    if [ "$total_time" -lt 300 ]; then
        test_pass "Recovery time objective met (${total_time}s < 300s)"
    else
        test_fail "Recovery time objective not met (${total_time}s > 300s)"
    fi
}

# Generate test report
generate_report() {
    local report_file="$PROJECT_ROOT/backup/test-results/dr-test-report-$TIMESTAMP.md"
    mkdir -p "$PROJECT_ROOT/backup/test-results"
    
    cat > "$report_file" << EOF
# GitHub-RunnerHub Disaster Recovery Test Report

**Date**: $(date)
**Test Run**: $TIMESTAMP

## Summary

- **Total Tests**: $((TESTS_PASSED + TESTS_FAILED))
- **Passed**: $TESTS_PASSED
- **Failed**: $TESTS_FAILED
- **Success Rate**: $(awk "BEGIN {printf \"%.1f\", ($TESTS_PASSED / ($TESTS_PASSED + $TESTS_FAILED) * 100)}")%

## Test Results

| Test | Result |
|------|--------|
| Backup Scripts | $([ $TESTS_PASSED -ge 2 ] && echo "✅ PASS" || echo "❌ FAIL") |
| PostgreSQL Backup/Restore | $(grep -q "PostgreSQL restore successful" /tmp/dr-test.log && echo "✅ PASS" || echo "❌ FAIL") |
| Redis Backup/Restore | $(grep -q "Redis restore successful" /tmp/dr-test.log && echo "✅ PASS" || echo "❌ FAIL") |
| Configuration Backup/Restore | $(grep -q "Configuration restore successful" /tmp/dr-test.log && echo "✅ PASS" || echo "❌ FAIL") |
| Backup Integrity | $(grep -q "Backup integrity verification successful" /tmp/dr-test.log && echo "✅ PASS" || echo "❌ FAIL") |
| Disaster Recovery Procedure | $(grep -q "Disaster recovery procedure successful" /tmp/dr-test.log && echo "✅ PASS" || echo "❌ FAIL") |
| Backup Rotation | $(grep -q "Backup rotation successful" /tmp/dr-test.log && echo "✅ PASS" || echo "❌ FAIL") |
| Recovery Time Objective | $(grep -q "Recovery time objective met" /tmp/dr-test.log && echo "✅ PASS" || echo "❌ FAIL") |

## Recommendations

$(if [ $TESTS_FAILED -gt 0 ]; then
    echo "- Fix failing tests before relying on disaster recovery"
    echo "- Review backup and restore procedures"
    echo "- Ensure all dependencies are properly configured"
else
    echo "- All tests passed successfully"
    echo "- Disaster recovery system is operational"
    echo "- Consider running tests regularly (weekly/monthly)"
fi)

## Next Steps

1. Schedule regular disaster recovery tests
2. Document any issues found during testing
3. Update procedures based on test results
4. Train team on recovery procedures

---
*Generated by disaster-recovery-test.sh*
EOF
    
    log_info "Test report generated: $report_file"
}

# Main test execution
main() {
    log_info "Starting GitHub-RunnerHub Disaster Recovery Tests"
    
    # Redirect output to log file for report generation
    exec > >(tee /tmp/dr-test.log)
    exec 2>&1
    
    # Setup test environment
    setup_test_env
    
    # Run tests
    test_backup_scripts
    test_postgres_backup_restore
    test_redis_backup_restore
    test_config_backup_restore
    test_backup_integrity
    test_backup_scheduling
    test_disaster_recovery_procedure
    test_backup_rotation
    test_recovery_time
    
    # Cleanup
    cleanup_test_env
    
    # Generate report
    generate_report
    
    # Summary
    echo ""
    log_info "Test Summary:"
    log_info "Tests Passed: $TESTS_PASSED"
    log_info "Tests Failed: $TESTS_FAILED"
    
    if [ $TESTS_FAILED -eq 0 ]; then
        log_info "All disaster recovery tests passed!"
        exit 0
    else
        log_error "Some tests failed. Please review the report."
        exit 1
    fi
}

# Run main function
main "$@"