#!/bin/bash
# Setup initial secrets in HashiCorp Vault for GitHub RunnerHub
# This script configures the required secret paths for the application

set -e

# Configuration
VAULT_ADDR="${VAULT_ADDR:-http://${VAULT_HOST:-localhost}:8200}"
VAULT_TOKEN="${VAULT_TOKEN:-your-vault-token}"
VAULT_NAMESPACE="${VAULT_NAMESPACE:-}"

echo "🔐 Setting up GitHub RunnerHub secrets in Vault"
echo "Vault Address: $VAULT_ADDR"
echo "================================================"

# Function to check if vault is available
check_vault() {
    echo -n "Checking Vault connectivity... "
    if curl -s -f "$VAULT_ADDR/v1/sys/health" > /dev/null 2>&1; then
        echo "✅ Connected"
        return 0
    else
        echo "❌ Failed"
        return 1
    fi
}

# Function to create a secret
create_secret() {
    local path=$1
    local data=$2
    
    echo "Creating secret at path: $path"
    
    curl -s -X POST \
        -H "X-Vault-Token: $VAULT_TOKEN" \
        -H "Content-Type: application/json" \
        -d "$data" \
        "$VAULT_ADDR/v1/secret/data/$path" > /dev/null
    
    if [ $? -eq 0 ]; then
        echo "✅ Secret created: $path"
    else
        echo "❌ Failed to create secret: $path"
        return 1
    fi
}

# Function to read existing secret
read_secret() {
    local path=$1
    
    curl -s -X GET \
        -H "X-Vault-Token: $VAULT_TOKEN" \
        "$VAULT_ADDR/v1/secret/data/$path" | jq -r '.data.data // empty'
}

# Check Vault connectivity
if ! check_vault; then
    echo "❌ Cannot connect to Vault. Please check:"
    echo "1. Vault is running at $VAULT_ADDR"
    echo "2. VAULT_TOKEN is correct"
    echo "3. Network connectivity"
    exit 1
fi

echo ""
echo "🔧 Creating GitHub RunnerHub secret paths..."

# 1. GitHub Secrets
echo "1. Setting up GitHub secrets..."
github_secrets=$(cat <<EOF
{
  "data": {
    "token": "${GITHUB_TOKEN:-github_pat_replace_me}",
    "webhook_secret": "${GITHUB_WEBHOOK_SECRET:-webhook_secret_replace_me}",
    "app_id": "${GITHUB_APP_ID:-}",
    "private_key": "${GITHUB_PRIVATE_KEY:-}",
    "created_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  }
}
EOF
)

create_secret "github/runnerhub" "$github_secrets"

# 2. Database Credentials
echo "2. Setting up database secrets..."
database_secrets=$(cat <<EOF
{
  "data": {
    "host": "${DB_HOST:-${VAULT_HOST:-localhost}}",
    "port": ${DB_PORT:-5433},
    "database": "${DB_NAME:-github_runnerhub}",
    "username": "${DB_USER:-app_user}",
    "password": "${DB_PASSWORD:-app_secure_2024}",
    "ssl": false,
    "created_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  }
}
EOF
)

create_secret "database/runnerhub" "$database_secrets"

# 3. Redis Credentials
echo "3. Setting up Redis secrets..."
redis_secrets=$(cat <<EOF
{
  "data": {
    "host": "${REDIS_HOST:-${VAULT_HOST:-localhost}}",
    "port": ${REDIS_PORT:-6379},
    "password": "${REDIS_PASSWORD:-}",
    "db": ${REDIS_DB:-0},
    "created_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  }
}
EOF
)

create_secret "redis/runnerhub" "$redis_secrets"

# 4. JWT and Security Secrets
echo "4. Setting up security secrets..."
jwt_secret="${JWT_SECRET:-$(openssl rand -base64 32)}"
encryption_key="${ENCRYPTION_KEY:-$(openssl rand -base64 32)}"

security_secrets=$(cat <<EOF
{
  "data": {
    "jwt_secret": "$jwt_secret",
    "encryption_key": "$encryption_key",
    "api_rate_limit": ${API_RATE_LIMIT:-100},
    "api_rate_window": ${API_RATE_WINDOW:-900000},
    "created_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  }
}
EOF
)

create_secret "security/runnerhub" "$security_secrets"

# 5. Docker Registry Secrets (if needed)
echo "5. Setting up Docker registry secrets..."
docker_secrets=$(cat <<EOF
{
  "data": {
    "registry_url": "${DOCKER_REGISTRY:-ghcr.io}",
    "username": "${DOCKER_USERNAME:-anubissbe}",
    "password": "${DOCKER_PASSWORD:-}",
    "namespace": "${DOCKER_NAMESPACE:-anubissbe}",
    "created_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  }
}
EOF
)

create_secret "docker/runnerhub" "$docker_secrets"

echo ""
echo "🔍 Verifying secret creation..."

# Verify secrets were created
secret_paths=(
    "github/runnerhub"
    "database/runnerhub"
    "redis/runnerhub"
    "security/runnerhub"
    "docker/runnerhub"
)

all_success=true
for path in "${secret_paths[@]}"; do
    echo -n "Checking $path... "
    if secret_data=$(read_secret "$path") && [ -n "$secret_data" ]; then
        echo "✅ Exists"
    else
        echo "❌ Missing"
        all_success=false
    fi
done

echo ""
if [ "$all_success" = true ]; then
    echo "🎉 All secrets created successfully!"
    echo ""
    echo "📋 Secret Paths Created:"
    echo "  • secret/github/runnerhub     - GitHub API tokens and webhook secrets"
    echo "  • secret/database/runnerhub   - PostgreSQL connection credentials"
    echo "  • secret/redis/runnerhub      - Redis connection credentials"
    echo "  • secret/security/runnerhub   - JWT tokens and encryption keys"
    echo "  • secret/docker/runnerhub     - Docker registry credentials"
    echo ""
    echo "🔧 Next Steps:"
    echo "1. Update actual credentials in Vault UI at $VAULT_ADDR"
    echo "2. Ensure VAULT_TOKEN is available to the application"
    echo "3. Start GitHub RunnerHub with Vault integration enabled"
    echo ""
    echo "⚠️  Security Notes:"
    echo "• Generated JWT and encryption keys are random - store them securely"
    echo "• Replace placeholder GitHub tokens with real values"
    echo "• Consider rotating secrets regularly"
else
    echo "❌ Some secrets failed to create. Check Vault logs and permissions."
    exit 1
fi

echo "🔐 Vault secret setup completed!"