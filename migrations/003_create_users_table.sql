-- Create users table for authentication
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS users (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'operator', 'viewer')),
    permissions JSONB DEFAULT '[]'::jsonb,
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_login TIMESTAMP WITH TIME ZONE
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_active ON users(active);
CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at);

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_users_updated_at 
    BEFORE UPDATE ON users 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Insert default admin user (password: admin123)
-- Password hash is bcrypt hash of 'admin123' with salt rounds 12
INSERT INTO users (username, email, password_hash, role, permissions) 
VALUES (
    'admin',
    'admin@github-runnerhub.local',
    '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewDBY8.4R0eVR6Va',
    'admin',
    '["users:read", "users:write", "users:delete", "jobs:read", "jobs:write", "jobs:delete", "runners:read", "runners:write", "runners:delete", "system:read", "system:write", "monitoring:read", "monitoring:write"]'::jsonb
) ON CONFLICT (username) DO NOTHING;

-- Insert operator user (password: operator123)
INSERT INTO users (username, email, password_hash, role, permissions)
VALUES (
    'operator',
    'operator@github-runnerhub.local',
    '$2b$12$hFGl3xNOjAT1XQRFK4p5t.xRlGK4Z3n.v1j2k3l4m5n6o7p8q9r0s',
    'operator',
    '["jobs:read", "jobs:write", "runners:read", "runners:write", "system:read", "monitoring:read"]'::jsonb
) ON CONFLICT (username) DO NOTHING;

-- Insert viewer user (password: viewer123)
INSERT INTO users (username, email, password_hash, role, permissions)
VALUES (
    'viewer',
    'viewer@github-runnerhub.local',
    '$2b$12$aNFEQr2B5YuQ6zXP1L4Nh.dKjF3mE8wR7sT9vA2cD5fG8hJ1kM4pL',
    'viewer',
    '["jobs:read", "runners:read", "system:read", "monitoring:read"]'::jsonb
) ON CONFLICT (username) DO NOTHING;

-- Create audit log for user actions
CREATE TABLE IF NOT EXISTS user_audit_log (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(50) NOT NULL,
    resource_type VARCHAR(50),
    resource_id VARCHAR(255),
    details JSONB,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for audit log
CREATE INDEX IF NOT EXISTS idx_user_audit_log_user_id ON user_audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_user_audit_log_action ON user_audit_log(action);
CREATE INDEX IF NOT EXISTS idx_user_audit_log_resource_type ON user_audit_log(resource_type);
CREATE INDEX IF NOT EXISTS idx_user_audit_log_created_at ON user_audit_log(created_at);

-- Create session tracking table
CREATE TABLE IF NOT EXISTS user_sessions (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(255) NOT NULL,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    last_used TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    active BOOLEAN DEFAULT true
);

-- Create indexes for sessions
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_token_hash ON user_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at ON user_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_user_sessions_active ON user_sessions(active);

-- Function to cleanup expired sessions
CREATE OR REPLACE FUNCTION cleanup_expired_sessions()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM user_sessions 
    WHERE expires_at < NOW() OR active = false;
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON TABLE users IS 'User accounts for GitHub RunnerHub authentication';
COMMENT ON TABLE user_audit_log IS 'Audit trail for user actions and security events';
COMMENT ON TABLE user_sessions IS 'Active user sessions and JWT token tracking';
COMMENT ON FUNCTION cleanup_expired_sessions() IS 'Cleanup expired and inactive user sessions';