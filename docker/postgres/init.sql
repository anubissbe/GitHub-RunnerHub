-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";

-- Create schema
CREATE SCHEMA IF NOT EXISTS runnerhub;

-- Set search path
SET search_path TO runnerhub, public;

-- Jobs table
CREATE TABLE IF NOT EXISTS jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    github_job_id BIGINT UNIQUE NOT NULL,
    repository VARCHAR(255) NOT NULL,
    workflow_name VARCHAR(255) NOT NULL,
    job_name VARCHAR(255) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'queued',
    runner_id UUID,
    container_id VARCHAR(255),
    labels TEXT[],
    metadata JSONB DEFAULT '{}',
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Runners table
CREATE TABLE IF NOT EXISTS runners (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) UNIQUE NOT NULL,
    type VARCHAR(50) NOT NULL DEFAULT 'ephemeral',
    status VARCHAR(50) NOT NULL DEFAULT 'idle',
    container_id VARCHAR(255),
    labels TEXT[],
    repository VARCHAR(255),
    github_runner_id BIGINT,
    registration_token TEXT,
    last_heartbeat TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Runner pools table
CREATE TABLE IF NOT EXISTS runner_pools (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    repository VARCHAR(255) UNIQUE NOT NULL,
    min_runners INTEGER NOT NULL DEFAULT 1,
    max_runners INTEGER NOT NULL DEFAULT 10,
    current_runners INTEGER NOT NULL DEFAULT 0,
    scale_increment INTEGER NOT NULL DEFAULT 5,
    scale_threshold DECIMAL(3,2) NOT NULL DEFAULT 0.8,
    last_scaled_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Metrics table
CREATE TABLE IF NOT EXISTS metrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    metric_type VARCHAR(50) NOT NULL,
    metric_name VARCHAR(255) NOT NULL,
    value DECIMAL,
    labels JSONB DEFAULT '{}',
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Audit logs table
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id VARCHAR(255),
    action VARCHAR(255) NOT NULL,
    resource_type VARCHAR(50),
    resource_id VARCHAR(255),
    details JSONB DEFAULT '{}',
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Network isolation table
CREATE TABLE IF NOT EXISTS network_isolation (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    repository VARCHAR(255) UNIQUE NOT NULL,
    network_name VARCHAR(255) NOT NULL,
    subnet CIDR NOT NULL,
    gateway INET NOT NULL,
    dns_servers INET[],
    allowed_egress JSONB DEFAULT '[]',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes
CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_jobs_repository ON jobs(repository);
CREATE INDEX idx_jobs_created_at ON jobs(created_at DESC);
CREATE INDEX idx_runners_status ON runners(status);
CREATE INDEX idx_runners_repository ON runners(repository);
CREATE INDEX idx_metrics_type_name ON metrics(metric_type, metric_name);
CREATE INDEX idx_metrics_timestamp ON metrics(timestamp DESC);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at DESC);

-- Create update trigger for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply update trigger to tables
CREATE TRIGGER update_jobs_updated_at BEFORE UPDATE ON jobs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_runners_updated_at BEFORE UPDATE ON runners
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_runner_pools_updated_at BEFORE UPDATE ON runner_pools
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_network_isolation_updated_at BEFORE UPDATE ON network_isolation
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Insert default runner pools for common repositories
INSERT INTO runner_pools (repository, min_runners, max_runners, scale_increment, scale_threshold)
VALUES 
    ('*', 1, 10, 5, 0.8), -- Default pool for all repositories
    ('anubissbe/Jarvis2.0', 1, 3, 1, 0.9) -- Jarvis specific pool
ON CONFLICT (repository) DO NOTHING;