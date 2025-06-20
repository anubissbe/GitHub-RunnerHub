-- Migration: Add cleanup history and archived logs tables
-- Version: 004
-- Description: Support for automated container cleanup tracking

-- Create archived logs table
CREATE TABLE IF NOT EXISTS runnerhub.archived_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    container_id VARCHAR(255) NOT NULL,
    container_name VARCHAR(255),
    logs TEXT,
    archived_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create cleanup history table
CREATE TABLE IF NOT EXISTS runnerhub.cleanup_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    policies_executed INTEGER NOT NULL DEFAULT 0,
    containers_inspected INTEGER NOT NULL DEFAULT 0,
    containers_cleaned INTEGER NOT NULL DEFAULT 0,
    errors INTEGER NOT NULL DEFAULT 0,
    disk_space_reclaimed BIGINT NOT NULL DEFAULT 0
);

-- Create cleanup details table for detailed tracking
CREATE TABLE IF NOT EXISTS runnerhub.cleanup_details (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    history_id UUID REFERENCES runnerhub.cleanup_history(id) ON DELETE CASCADE,
    container_id VARCHAR(255) NOT NULL,
    container_name VARCHAR(255),
    policy_name VARCHAR(255),
    reason TEXT,
    action VARCHAR(50), -- 'stopped', 'removed', 'skipped'
    error TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX idx_archived_logs_container_id ON runnerhub.archived_logs(container_id);
CREATE INDEX idx_archived_logs_archived_at ON runnerhub.archived_logs(archived_at);
CREATE INDEX idx_cleanup_history_timestamp ON runnerhub.cleanup_history(timestamp);
CREATE INDEX idx_cleanup_details_history_id ON runnerhub.cleanup_details(history_id);

-- Comments
COMMENT ON TABLE runnerhub.archived_logs IS 'Stores container logs before cleanup for audit purposes';
COMMENT ON TABLE runnerhub.cleanup_history IS 'Tracks cleanup run statistics and results';
COMMENT ON TABLE runnerhub.cleanup_details IS 'Detailed records of individual container cleanup actions';

-- Add cleanup metadata to containers (if not exists)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'runnerhub' 
        AND table_name = 'containers' 
        AND column_name = 'last_activity'
    ) THEN
        ALTER TABLE runnerhub.containers 
        ADD COLUMN last_activity TIMESTAMP;
    END IF;
END $$;