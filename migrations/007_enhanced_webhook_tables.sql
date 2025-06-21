-- Migration: Enhanced webhook tables
-- Description: Add enhanced webhook event tracking with deduplication and metrics

-- Enhanced webhook events table
CREATE TABLE IF NOT EXISTS runnerhub.webhook_events (
    id VARCHAR(255) PRIMARY KEY,
    repository VARCHAR(255) NOT NULL,
    event VARCHAR(100) NOT NULL,
    action VARCHAR(100),
    payload JSONB NOT NULL,
    signature VARCHAR(255),
    delivery_id VARCHAR(255) NOT NULL,
    timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    processed BOOLEAN NOT NULL DEFAULT FALSE,
    processing_attempts INTEGER NOT NULL DEFAULT 0,
    last_processing_error TEXT,
    processing_duration_ms INTEGER,
    dedup_key VARCHAR(255),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for webhook events
CREATE INDEX IF NOT EXISTS idx_webhook_events_repository 
ON runnerhub.webhook_events(repository);

CREATE INDEX IF NOT EXISTS idx_webhook_events_event 
ON runnerhub.webhook_events(event);

CREATE INDEX IF NOT EXISTS idx_webhook_events_timestamp 
ON runnerhub.webhook_events(timestamp);

CREATE INDEX IF NOT EXISTS idx_webhook_events_dedup_key 
ON runnerhub.webhook_events(dedup_key);

CREATE INDEX IF NOT EXISTS idx_webhook_events_processed 
ON runnerhub.webhook_events(processed);

CREATE INDEX IF NOT EXISTS idx_webhook_events_delivery_id
ON runnerhub.webhook_events(delivery_id);

-- Webhook metrics table
CREATE TABLE IF NOT EXISTS runnerhub.webhook_metrics (
    id SERIAL PRIMARY KEY,
    event_type VARCHAR(100) NOT NULL,
    success BOOLEAN NOT NULL,
    processing_time_ms INTEGER NOT NULL,
    recorded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for webhook metrics
CREATE INDEX IF NOT EXISTS idx_webhook_metrics_event_type 
ON runnerhub.webhook_metrics(event_type);

CREATE INDEX IF NOT EXISTS idx_webhook_metrics_recorded_at 
ON runnerhub.webhook_metrics(recorded_at);

CREATE INDEX IF NOT EXISTS idx_webhook_metrics_success
ON runnerhub.webhook_metrics(success);

-- Workflow runs table (enhanced)
CREATE TABLE IF NOT EXISTS runnerhub.workflow_runs (
    run_id BIGINT PRIMARY KEY,
    repository VARCHAR(255) NOT NULL,
    workflow_name VARCHAR(255) NOT NULL,
    head_branch VARCHAR(255),
    head_sha VARCHAR(255),
    event VARCHAR(100),
    status VARCHAR(100),
    conclusion VARCHAR(100),
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);

-- Indexes for workflow runs
CREATE INDEX IF NOT EXISTS idx_workflow_runs_repository 
ON runnerhub.workflow_runs(repository);

CREATE INDEX IF NOT EXISTS idx_workflow_runs_status 
ON runnerhub.workflow_runs(status);

CREATE INDEX IF NOT EXISTS idx_workflow_runs_created_at
ON runnerhub.workflow_runs(created_at);

-- Job metrics table (for detailed job tracking)
CREATE TABLE IF NOT EXISTS runnerhub.job_metrics (
    job_id VARCHAR(255) PRIMARY KEY,
    repository VARCHAR(255) NOT NULL,
    conclusion VARCHAR(100),
    duration BIGINT,
    runner_id VARCHAR(255),
    recorded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for job metrics
CREATE INDEX IF NOT EXISTS idx_job_metrics_repository
ON runnerhub.job_metrics(repository);

CREATE INDEX IF NOT EXISTS idx_job_metrics_recorded_at
ON runnerhub.job_metrics(recorded_at);

-- Repository statistics table
CREATE TABLE IF NOT EXISTS runnerhub.repository_stats (
    repository VARCHAR(255) PRIMARY KEY,
    total_jobs INTEGER NOT NULL DEFAULT 0,
    successful_jobs INTEGER NOT NULL DEFAULT 0,
    failed_jobs INTEGER NOT NULL DEFAULT 0,
    last_job_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Add duration_ms column to jobs table if not exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'runnerhub' 
        AND table_name = 'jobs' 
        AND column_name = 'duration_ms'
    ) THEN
        ALTER TABLE runnerhub.jobs ADD COLUMN duration_ms BIGINT;
    END IF;
END $$;

-- Add priority column to jobs table if not exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'runnerhub' 
        AND table_name = 'jobs' 
        AND column_name = 'priority'
    ) THEN
        ALTER TABLE runnerhub.jobs ADD COLUMN priority INTEGER DEFAULT 0;
    END IF;
END $$;

-- Add workflow_name column to jobs table if not exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'runnerhub' 
        AND table_name = 'jobs' 
        AND column_name = 'workflow_name'
    ) THEN
        ALTER TABLE runnerhub.jobs ADD COLUMN workflow_name VARCHAR(255);
    END IF;
END $$;

-- Create trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply trigger to webhook_events table
DROP TRIGGER IF EXISTS update_webhook_events_updated_at ON runnerhub.webhook_events;
CREATE TRIGGER update_webhook_events_updated_at
    BEFORE UPDATE ON runnerhub.webhook_events
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Apply trigger to repository_stats table
DROP TRIGGER IF EXISTS update_repository_stats_updated_at ON runnerhub.repository_stats;
CREATE TRIGGER update_repository_stats_updated_at
    BEFORE UPDATE ON runnerhub.repository_stats
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Create view for webhook event statistics
CREATE OR REPLACE VIEW runnerhub.webhook_event_stats AS
SELECT 
    event,
    COUNT(*) as total_events,
    COUNT(*) FILTER (WHERE processed = true) as processed_events,
    COUNT(*) FILTER (WHERE processed = false) as pending_events,
    COUNT(*) FILTER (WHERE last_processing_error IS NOT NULL) as failed_events,
    AVG(processing_duration_ms) FILTER (WHERE processing_duration_ms IS NOT NULL) as avg_processing_time_ms,
    MIN(timestamp) as first_event_at,
    MAX(timestamp) as last_event_at
FROM runnerhub.webhook_events
GROUP BY event;

-- Create view for repository activity
CREATE OR REPLACE VIEW runnerhub.repository_activity AS
SELECT 
    r.repository,
    r.total_jobs,
    r.successful_jobs,
    r.failed_jobs,
    r.last_job_at,
    COUNT(DISTINCT w.run_id) as total_workflow_runs,
    COUNT(DISTINCT we.id) as total_webhook_events
FROM runnerhub.repository_stats r
LEFT JOIN runnerhub.workflow_runs w ON w.repository = r.repository
LEFT JOIN runnerhub.webhook_events we ON we.repository = r.repository
GROUP BY r.repository, r.total_jobs, r.successful_jobs, r.failed_jobs, r.last_job_at;

-- Grant permissions
GRANT ALL ON ALL TABLES IN SCHEMA runnerhub TO app_user;
GRANT ALL ON ALL SEQUENCES IN SCHEMA runnerhub TO app_user;
GRANT SELECT ON ALL TABLES IN SCHEMA runnerhub TO app_user;