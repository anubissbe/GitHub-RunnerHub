#!/bin/bash
# Test authentication endpoints for GitHub RunnerHub
# This script tests the JWT authentication system

set -e

# Configuration
API_URL="${API_URL:-http://localhost:3000/api}"
AUTH_URL="$API_URL/auth"

echo "🔐 Testing GitHub RunnerHub Authentication"
echo "========================================"
echo "API URL: $API_URL"
echo ""

# Function to make API call
api_call() {
    local method=$1
    local endpoint=$2
    local data=$3
    local token=$4
    
    local curl_cmd="curl -s -X $method"
    curl_cmd="$curl_cmd -H 'Content-Type: application/json'"
    
    if [ -n "$token" ]; then
        curl_cmd="$curl_cmd -H 'Authorization: Bearer $token'"
    fi
    
    if [ -n "$data" ]; then
        curl_cmd="$curl_cmd -d '$data'"
    fi
    
    curl_cmd="$curl_cmd $endpoint"
    
    echo "$ $curl_cmd"
    eval $curl_cmd
    echo ""
}

# Function to extract token from response
extract_token() {
    echo "$1" | jq -r '.data.token // empty'
}

# Function to check if response is successful
is_success() {
    echo "$1" | jq -r '.success' | grep -q "true"
}

echo "🧪 Test 1: Login with admin user"
echo "--------------------------------"
admin_response=$(api_call POST "$AUTH_URL/login" '{
    "username": "admin",
    "password": "admin123"
}')

echo "$admin_response" | jq '.'

if is_success "$admin_response"; then
    admin_token=$(extract_token "$admin_response")
    echo "✅ Admin login successful"
    echo "Token: ${admin_token:0:20}..."
else
    echo "❌ Admin login failed"
    exit 1
fi

echo ""
echo "🧪 Test 2: Get admin profile"
echo "----------------------------"
profile_response=$(api_call GET "$AUTH_URL/profile" "" "$admin_token")
echo "$profile_response" | jq '.'

if is_success "$profile_response"; then
    echo "✅ Profile retrieval successful"
else
    echo "❌ Profile retrieval failed"
fi

echo ""
echo "🧪 Test 3: Test operator login"
echo "------------------------------"
operator_response=$(api_call POST "$AUTH_URL/login" '{
    "username": "operator",
    "password": "operator123"
}')

echo "$operator_response" | jq '.'

if is_success "$operator_response"; then
    operator_token=$(extract_token "$operator_response")
    echo "✅ Operator login successful"
    echo "Token: ${operator_token:0:20}..."
else
    echo "❌ Operator login failed"
fi

echo ""
echo "🧪 Test 4: Test viewer login"
echo "----------------------------"
viewer_response=$(api_call POST "$AUTH_URL/login" '{
    "username": "viewer",
    "password": "viewer123"
}')

echo "$viewer_response" | jq '.'

if is_success "$viewer_response"; then
    viewer_token=$(extract_token "$viewer_response")
    echo "✅ Viewer login successful"
    echo "Token: ${viewer_token:0:20}..."
else
    echo "❌ Viewer login failed"
fi

echo ""
echo "🧪 Test 5: Test unauthorized access"
echo "-----------------------------------"
unauthorized_response=$(api_call GET "$AUTH_URL/users" "" "")
echo "$unauthorized_response" | jq '.'

if ! is_success "$unauthorized_response"; then
    echo "✅ Unauthorized access properly blocked"
else
    echo "❌ Unauthorized access not blocked"
fi

echo ""
echo "🧪 Test 6: Test admin-only endpoint with operator token"
echo "------------------------------------------------------"
if [ -n "$operator_token" ]; then
    forbidden_response=$(api_call GET "$AUTH_URL/users" "" "$operator_token")
    echo "$forbidden_response" | jq '.'
    
    if ! is_success "$forbidden_response"; then
        echo "✅ Role-based access control working"
    else
        echo "❌ Role-based access control failed"
    fi
else
    echo "⏭️ Skipping (no operator token)"
fi

echo ""
echo "🧪 Test 7: List users with admin token"
echo "--------------------------------------"
if [ -n "$admin_token" ]; then
    users_response=$(api_call GET "$AUTH_URL/users" "" "$admin_token")
    echo "$users_response" | jq '.'
    
    if is_success "$users_response"; then
        user_count=$(echo "$users_response" | jq '.data.total')
        echo "✅ Users listed successfully (Total: $user_count)"
    else
        echo "❌ Failed to list users"
    fi
else
    echo "⏭️ Skipping (no admin token)"
fi

echo ""
echo "🧪 Test 8: Token refresh"
echo "------------------------"
if [ -n "$admin_token" ]; then
    refresh_response=$(api_call POST "$AUTH_URL/refresh" "" "$admin_token")
    echo "$refresh_response" | jq '.'
    
    if is_success "$refresh_response"; then
        new_token=$(extract_token "$refresh_response")
        echo "✅ Token refresh successful"
        echo "New token: ${new_token:0:20}..."
    else
        echo "❌ Token refresh failed"
    fi
else
    echo "⏭️ Skipping (no admin token)"
fi

echo ""
echo "🧪 Test 9: Invalid credentials"
echo "------------------------------"
invalid_response=$(api_call POST "$AUTH_URL/login" '{
    "username": "admin",
    "password": "wrongpassword"
}')

echo "$invalid_response" | jq '.'

if ! is_success "$invalid_response"; then
    echo "✅ Invalid credentials properly rejected"
else
    echo "❌ Invalid credentials accepted"
fi

echo ""
echo "🧪 Test 10: System health endpoint (no auth required)"
echo "----------------------------------------------------"
health_response=$(api_call GET "$API_URL/system/health" "" "")
echo "$health_response" | jq '.'

if is_success "$health_response"; then
    echo "✅ System health accessible without auth"
else
    echo "❌ System health endpoint failed"
fi

echo ""
echo "🎉 Authentication Test Summary"
echo "============================="
echo "✅ All authentication tests completed"
echo ""
echo "🔑 Test Credentials:"
echo "Admin:    username: admin,    password: admin123"
echo "Operator: username: operator, password: operator123"  
echo "Viewer:   username: viewer,   password: viewer123"
echo ""
echo "📋 API Endpoints:"
echo "POST $AUTH_URL/login          - User login"
echo "POST $AUTH_URL/refresh        - Refresh token"
echo "GET  $AUTH_URL/profile        - Get user profile"
echo "GET  $AUTH_URL/users          - List users (admin only)"
echo "POST $AUTH_URL/users          - Create user (admin only)"
echo "PUT  $AUTH_URL/users/:id      - Update user (admin only)"
echo "DELETE $AUTH_URL/users/:id    - Delete user (admin only)"