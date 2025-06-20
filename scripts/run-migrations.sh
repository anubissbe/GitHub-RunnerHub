#!/bin/bash
# Run database migrations for GitHub RunnerHub
# This script applies all pending migrations to the PostgreSQL database

set -e

# Configuration
DB_HOST="${DB_HOST:-192.168.1.24}"
DB_PORT="${DB_PORT:-5433}"
DB_NAME="${DB_NAME:-github_runnerhub}"
DB_USER="${DB_USER:-app_user}"
DB_PASSWORD="${DB_PASSWORD:-app_secure_2024}"
DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}"

MIGRATIONS_DIR="$(dirname "$0")/../migrations"

echo "🔄 Running GitHub RunnerHub Database Migrations"
echo "================================================="
echo "Database: $DB_NAME at $DB_HOST:$DB_PORT"
echo "Migrations directory: $MIGRATIONS_DIR"
echo ""

# Function to check database connectivity
check_database() {
    echo -n "Checking database connectivity... "
    if psql "$DATABASE_URL" -c "SELECT 1;" > /dev/null 2>&1; then
        echo "✅ Connected"
        return 0
    else
        echo "❌ Failed"
        return 1
    fi
}

# Function to create migrations table if it doesn't exist
create_migrations_table() {
    echo "Creating migrations tracking table..."
    psql "$DATABASE_URL" << 'EOF'
CREATE TABLE IF NOT EXISTS schema_migrations (
    id SERIAL PRIMARY KEY,
    version VARCHAR(255) UNIQUE NOT NULL,
    filename VARCHAR(255) NOT NULL,
    executed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    execution_time_ms INTEGER
);

CREATE INDEX IF NOT EXISTS idx_schema_migrations_version ON schema_migrations(version);
CREATE INDEX IF NOT EXISTS idx_schema_migrations_executed_at ON schema_migrations(executed_at);
EOF
    echo "✅ Migrations table ready"
}

# Function to check if migration has been applied
is_migration_applied() {
    local version=$1
    local count=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM schema_migrations WHERE version = '$version';")
    [ "$count" -gt 0 ]
}

# Function to apply a migration
apply_migration() {
    local file=$1
    local version=$(basename "$file" .sql)
    
    echo "Applying migration: $version"
    
    local start_time=$(date +%s%3N)
    
    # Run the migration in a transaction
    psql "$DATABASE_URL" << EOF
BEGIN;

-- Apply the migration
\i $file

-- Record the migration
INSERT INTO schema_migrations (version, filename) 
VALUES ('$version', '$(basename "$file")');

COMMIT;
EOF
    
    local end_time=$(date +%s%3N)
    local execution_time=$((end_time - start_time))
    
    # Update execution time
    psql "$DATABASE_URL" -c "UPDATE schema_migrations SET execution_time_ms = $execution_time WHERE version = '$version';"
    
    echo "✅ Applied $version (${execution_time}ms)"
}

# Function to list applied migrations
list_applied_migrations() {
    echo ""
    echo "📋 Applied Migrations:"
    echo "---------------------"
    psql "$DATABASE_URL" -c "
    SELECT 
        version,
        filename,
        executed_at,
        execution_time_ms || 'ms' as duration
    FROM schema_migrations 
    ORDER BY executed_at;
    "
}

# Main execution
main() {
    # Check database connectivity
    if ! check_database; then
        echo "❌ Cannot connect to database. Please check:"
        echo "1. Database is running at $DB_HOST:$DB_PORT"
        echo "2. Database '$DB_NAME' exists"
        echo "3. User '$DB_USER' has proper permissions"
        echo "4. Connection parameters are correct"
        exit 1
    fi

    # Create migrations table
    create_migrations_table

    # Check if migrations directory exists
    if [ ! -d "$MIGRATIONS_DIR" ]; then
        echo "❌ Migrations directory not found: $MIGRATIONS_DIR"
        exit 1
    fi

    # Find all migration files
    migration_files=($(find "$MIGRATIONS_DIR" -name "*.sql" | sort))
    
    if [ ${#migration_files[@]} -eq 0 ]; then
        echo "⚠️ No migration files found in $MIGRATIONS_DIR"
        exit 0
    fi

    echo "Found ${#migration_files[@]} migration file(s)"
    echo ""

    # Apply migrations
    applied_count=0
    skipped_count=0

    for file in "${migration_files[@]}"; do
        version=$(basename "$file" .sql)
        
        if is_migration_applied "$version"; then
            echo "⏭️ Skipping $version (already applied)"
            ((skipped_count++))
        else
            apply_migration "$file"
            ((applied_count++))
        fi
    done

    echo ""
    echo "🎉 Migration Summary:"
    echo "Applied: $applied_count"
    echo "Skipped: $skipped_count"
    echo "Total: ${#migration_files[@]}"

    # Show applied migrations
    list_applied_migrations

    echo ""
    echo "✅ Database migrations completed successfully!"
}

# Error handling
trap 'echo "❌ Migration failed"; exit 1' ERR

# Run migrations
main "$@"