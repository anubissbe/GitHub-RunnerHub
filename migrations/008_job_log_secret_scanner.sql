-- Migration: Job Log Secret Scanner
-- Description: Add tables for job log secret scanning functionality
-- Author: Claude Code
-- Date: 2025-06-21

-- Table for storing secret scanning results
CREATE TABLE IF NOT EXISTS job_log_secret_scans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id VARCHAR(100) NOT NULL,
    scan_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    scan_duration INTEGER NOT NULL, -- Duration in milliseconds
    detected_secrets JSONB DEFAULT '[]'::jsonb,
    summary JSONB NOT NULL DEFAULT '{
        "totalSecrets": 0,
        "criticalSecrets": 0,
        "highSecrets": 0,
        "mediumSecrets": 0,
        "lowSecrets": 0,
        "categoryCounts": {}
    }'::jsonb,
    status VARCHAR(20) NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'failed', 'in_progress')),
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index for efficient querying
CREATE INDEX IF NOT EXISTS idx_job_log_secret_scans_job_id ON job_log_secret_scans(job_id);
CREATE INDEX IF NOT EXISTS idx_job_log_secret_scans_scan_date ON job_log_secret_scans(scan_date);
CREATE INDEX IF NOT EXISTS idx_job_log_secret_scans_status ON job_log_secret_scans(status);

-- Table for custom secret patterns
CREATE TABLE IF NOT EXISTS secret_patterns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL UNIQUE,
    description TEXT,
    regex_pattern TEXT NOT NULL,
    regex_flags VARCHAR(10) DEFAULT 'gi',
    minimum_entropy DECIMAL(4,2) DEFAULT 3.0,
    enabled BOOLEAN DEFAULT true,
    severity VARCHAR(20) NOT NULL DEFAULT 'medium' CHECK (severity IN ('critical', 'high', 'medium', 'low')),
    category VARCHAR(50) NOT NULL DEFAULT 'generic' CHECK (category IN (
        'api_key', 'password', 'token', 'certificate', 'private_key',
        'database_url', 'cloud_credentials', 'jwt', 'ssh_key', 'generic'
    )),
    redaction_pattern VARCHAR(255),
    whitelist_patterns JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index for pattern management
CREATE INDEX IF NOT EXISTS idx_secret_patterns_enabled ON secret_patterns(enabled);
CREATE INDEX IF NOT EXISTS idx_secret_patterns_category ON secret_patterns(category);

-- Table for secret scanner configuration
CREATE TABLE IF NOT EXISTS secret_scanner_config (
    id VARCHAR(50) PRIMARY KEY DEFAULT 'default',
    enabled BOOLEAN DEFAULT true,
    auto_redact BOOLEAN DEFAULT true,
    whitelist_repositories JSONB DEFAULT '[]'::jsonb,
    minimum_entropy DECIMAL(4,2) DEFAULT 3.0,
    confidence_threshold DECIMAL(3,2) DEFAULT 0.7,
    preserve_formatting BOOLEAN DEFAULT true,
    notify_on_detection BOOLEAN DEFAULT true,
    block_job_on_secrets BOOLEAN DEFAULT false,
    allowed_file_extensions JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Insert default configuration
INSERT INTO secret_scanner_config (id) VALUES ('default') ON CONFLICT (id) DO NOTHING;

-- Add indexes for JSONB columns for better performance
CREATE INDEX IF NOT EXISTS idx_secret_scans_summary_total 
    ON job_log_secret_scans USING GIN ((summary->'totalSecrets'));

CREATE INDEX IF NOT EXISTS idx_secret_scans_summary_critical 
    ON job_log_secret_scans USING GIN ((summary->'criticalSecrets'));

-- Add a column to the jobs table to track if logs have been scanned
ALTER TABLE runnerhub.jobs 
ADD COLUMN IF NOT EXISTS logs_scanned BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS logs_scan_date TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS secrets_detected INTEGER DEFAULT 0;

-- Create index for log scanning status
CREATE INDEX IF NOT EXISTS idx_jobs_logs_scanned ON runnerhub.jobs(logs_scanned);

-- Function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add triggers for updated_at columns
CREATE TRIGGER update_secret_patterns_updated_at
    BEFORE UPDATE ON secret_patterns
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_secret_scanner_config_updated_at
    BEFORE UPDATE ON secret_scanner_config
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Add some default secret patterns (these will be managed by the application)
INSERT INTO secret_patterns (name, description, regex_pattern, severity, category, minimum_entropy) VALUES
('GitHub Token Pattern', 'Detects GitHub personal access tokens and app tokens', 'gh[ps]_[a-zA-Z0-9]{36}|github_pat_[a-zA-Z0-9]{22}_[a-zA-Z0-9]{59}', 'critical', 'token', 4.0),
('AWS Access Key Pattern', 'Detects AWS access key IDs', 'AKIA[0-9A-Z]{16}', 'critical', 'cloud_credentials', 3.5),
('Generic API Key Pattern', 'Detects common API key patterns', 'api[_-]?key[_-]?[=:][\s]*["\''']?([a-zA-Z0-9_\-]{16,})["\''']?', 'high', 'api_key', 3.0),
('JWT Token Pattern', 'Detects JSON Web Tokens', 'eyJ[a-zA-Z0-9_-]*\.eyJ[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*', 'high', 'jwt', 4.0),
('Database URL Pattern', 'Detects database connection strings', '(postgresql|mysql|mongodb|redis):\/\/[^:]*:[^@]*@[^\/\s]*', 'high', 'database_url', 2.5)
ON CONFLICT (name) DO NOTHING;

-- Create a view for secret scanning statistics
CREATE OR REPLACE VIEW secret_scanning_stats AS
SELECT 
    DATE_TRUNC('day', scan_date) as scan_day,
    COUNT(*) as total_scans,
    SUM((summary->>'totalSecrets')::int) as total_secrets_found,
    SUM((summary->>'criticalSecrets')::int) as critical_secrets,
    SUM((summary->>'highSecrets')::int) as high_secrets,
    SUM((summary->>'mediumSecrets')::int) as medium_secrets,
    SUM((summary->>'lowSecrets')::int) as low_secrets,
    COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_scans
FROM job_log_secret_scans
WHERE scan_date >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY DATE_TRUNC('day', scan_date)
ORDER BY scan_day DESC;

-- Grant necessary permissions (adjust as needed for your setup)
-- GRANT SELECT, INSERT, UPDATE, DELETE ON job_log_secret_scans TO app_user;
-- GRANT SELECT, INSERT, UPDATE, DELETE ON secret_patterns TO app_user;
-- GRANT SELECT, INSERT, UPDATE, DELETE ON secret_scanner_config TO app_user;
-- GRANT SELECT ON secret_scanning_stats TO app_user;

COMMENT ON TABLE job_log_secret_scans IS 'Stores results of secret scanning performed on job logs';
COMMENT ON TABLE secret_patterns IS 'Custom secret detection patterns with configuration';
COMMENT ON TABLE secret_scanner_config IS 'Global configuration for the secret scanner';
COMMENT ON VIEW secret_scanning_stats IS 'Daily statistics for secret scanning activities';