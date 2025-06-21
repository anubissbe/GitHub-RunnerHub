-- Load Testing Database Initialization
-- Optimized schema for GitHub-RunnerHub load testing

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";

-- Create jobs table optimized for load testing
CREATE TABLE IF NOT EXISTS jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_name VARCHAR(255) NOT NULL,
    repository VARCHAR(255) NOT NULL,
    run_id BIGINT NOT NULL,
    status VARCHAR(50) DEFAULT 'queued',
    runner_name VARCHAR(255),
    labels TEXT[],
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    duration_ms INTEGER,
    result JSONB,
    error_message TEXT,
    metadata JSONB DEFAULT '{}'::jsonb
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at);
CREATE INDEX IF NOT EXISTS idx_jobs_repository ON jobs(repository);
CREATE INDEX IF NOT EXISTS idx_jobs_runner_name ON jobs(runner_name);
CREATE INDEX IF NOT EXISTS idx_jobs_run_id ON jobs(run_id);
CREATE INDEX IF NOT EXISTS idx_jobs_labels ON jobs USING GIN(labels);

-- Create runners table
CREATE TABLE IF NOT EXISTS runners (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) UNIQUE NOT NULL,
    status VARCHAR(50) DEFAULT 'idle',
    labels TEXT[],
    current_job_id UUID REFERENCES jobs(id),
    last_seen TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    metadata JSONB DEFAULT '{}'::jsonb,
    resource_limits JSONB DEFAULT '{}'::jsonb
);

-- Create indexes for runners
CREATE INDEX IF NOT EXISTS idx_runners_status ON runners(status);
CREATE INDEX IF NOT EXISTS idx_runners_name ON runners(name);
CREATE INDEX IF NOT EXISTS idx_runners_last_seen ON runners(last_seen);
CREATE INDEX IF NOT EXISTS idx_runners_labels ON runners USING GIN(labels);

-- Create job queue table for BullMQ integration
CREATE TABLE IF NOT EXISTS job_queue (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id UUID NOT NULL REFERENCES jobs(id),
    queue_name VARCHAR(255) NOT NULL,
    priority INTEGER DEFAULT 0,
    attempts INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 3,
    delay_until TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    processed_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    failed_at TIMESTAMP WITH TIME ZONE,
    data JSONB DEFAULT '{}'::jsonb,
    progress JSONB DEFAULT '{}'::jsonb,
    error JSONB
);

-- Create indexes for job queue
CREATE INDEX IF NOT EXISTS idx_job_queue_status ON job_queue(processed_at, completed_at, failed_at);
CREATE INDEX IF NOT EXISTS idx_job_queue_priority ON job_queue(priority DESC, created_at);
CREATE INDEX IF NOT EXISTS idx_job_queue_delay ON job_queue(delay_until) WHERE delay_until IS NOT NULL;

-- Create load test metrics table
CREATE TABLE IF NOT EXISTS load_test_metrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    test_run_id VARCHAR(255) NOT NULL,
    metric_name VARCHAR(255) NOT NULL,
    metric_value NUMERIC,
    metric_unit VARCHAR(50),
    labels JSONB DEFAULT '{}'::jsonb,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for metrics
CREATE INDEX IF NOT EXISTS idx_load_test_metrics_run_id ON load_test_metrics(test_run_id);
CREATE INDEX IF NOT EXISTS idx_load_test_metrics_name ON load_test_metrics(metric_name);
CREATE INDEX IF NOT EXISTS idx_load_test_metrics_timestamp ON load_test_metrics(timestamp);

-- Create scaling events table
CREATE TABLE IF NOT EXISTS scaling_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_type VARCHAR(50) NOT NULL, -- 'scale_up', 'scale_down'
    trigger_reason VARCHAR(255),
    runner_count_before INTEGER,
    runner_count_after INTEGER,
    scaling_decision JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for scaling events
CREATE INDEX IF NOT EXISTS idx_scaling_events_created_at ON scaling_events(created_at);
CREATE INDEX IF NOT EXISTS idx_scaling_events_type ON scaling_events(event_type);

-- Create performance monitoring view
CREATE OR REPLACE VIEW performance_summary AS
SELECT 
    COUNT(*) as total_jobs,
    COUNT(*) FILTER (WHERE status = 'completed') as completed_jobs,
    COUNT(*) FILTER (WHERE status = 'failed') as failed_jobs,
    COUNT(*) FILTER (WHERE status = 'running') as running_jobs,
    COUNT(*) FILTER (WHERE status = 'queued') as queued_jobs,
    AVG(duration_ms) FILTER (WHERE status = 'completed') as avg_duration_ms,
    MAX(duration_ms) FILTER (WHERE status = 'completed') as max_duration_ms,
    MIN(duration_ms) FILTER (WHERE status = 'completed') as min_duration_ms,
    PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms) FILTER (WHERE status = 'completed') as p95_duration_ms,
    PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY duration_ms) FILTER (WHERE status = 'completed') as p99_duration_ms
FROM jobs
WHERE created_at >= NOW() - INTERVAL '1 hour';

-- Create throughput monitoring view
CREATE OR REPLACE VIEW throughput_summary AS
SELECT 
    date_trunc('minute', created_at) as time_bucket,
    COUNT(*) as jobs_created,
    COUNT(*) FILTER (WHERE status = 'completed') as jobs_completed,
    COUNT(*) FILTER (WHERE status = 'failed') as jobs_failed,
    AVG(duration_ms) FILTER (WHERE status = 'completed') as avg_duration_ms
FROM jobs
WHERE created_at >= NOW() - INTERVAL '1 hour'
GROUP BY date_trunc('minute', created_at)
ORDER BY time_bucket;

-- Create runner utilization view
CREATE OR REPLACE VIEW runner_utilization AS
SELECT 
    name,
    status,
    labels,
    current_job_id IS NOT NULL as has_active_job,
    last_seen,
    EXTRACT(EPOCH FROM (NOW() - last_seen)) as seconds_since_last_seen
FROM runners
ORDER BY last_seen DESC;

-- Create functions for load testing

-- Function to generate test jobs
CREATE OR REPLACE FUNCTION generate_test_jobs(
    job_count INTEGER DEFAULT 100,
    repository_name VARCHAR DEFAULT 'test/load-testing'
)
RETURNS INTEGER AS $$
DECLARE
    i INTEGER;
    job_id UUID;
BEGIN
    FOR i IN 1..job_count LOOP
        INSERT INTO jobs (
            job_name,
            repository,
            run_id,
            labels,
            metadata
        ) VALUES (
            'load-test-job-' || i,
            repository_name,
            1000000 + i,
            ARRAY['self-hosted', 'docker', 'load-test'],
            jsonb_build_object('test_batch', 'auto-generated', 'batch_size', job_count)
        ) RETURNING id INTO job_id;
        
        -- Add to job queue
        INSERT INTO job_queue (job_id, queue_name, priority)
        VALUES (job_id, 'default', 0);
    END LOOP;
    
    RETURN job_count;
END;
$$ LANGUAGE plpgsql;

-- Function to clean up test data
CREATE OR REPLACE FUNCTION cleanup_test_data(
    older_than_hours INTEGER DEFAULT 1
)
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    -- Clean up old jobs
    DELETE FROM job_queue 
    WHERE job_id IN (
        SELECT id FROM jobs 
        WHERE created_at < NOW() - (older_than_hours || ' hours')::INTERVAL
        AND repository LIKE '%load-testing%'
    );
    
    DELETE FROM jobs 
    WHERE created_at < NOW() - (older_than_hours || ' hours')::INTERVAL
    AND repository LIKE '%load-testing%';
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    
    -- Clean up old metrics
    DELETE FROM load_test_metrics
    WHERE timestamp < NOW() - (older_than_hours || ' hours')::INTERVAL;
    
    -- Clean up old scaling events
    DELETE FROM scaling_events
    WHERE created_at < NOW() - (older_than_hours || ' hours')::INTERVAL;
    
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Function to record load test metrics
CREATE OR REPLACE FUNCTION record_load_test_metric(
    test_run_id VARCHAR,
    metric_name VARCHAR,
    metric_value NUMERIC,
    metric_unit VARCHAR DEFAULT '',
    metric_labels JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID AS $$
DECLARE
    metric_id UUID;
BEGIN
    INSERT INTO load_test_metrics (
        test_run_id,
        metric_name,
        metric_value,
        metric_unit,
        labels
    ) VALUES (
        test_run_id,
        metric_name,
        metric_value,
        metric_unit,
        metric_labels
    ) RETURNING id INTO metric_id;
    
    RETURN metric_id;
END;
$$ LANGUAGE plpgsql;

-- Create user for load testing
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'loadtest_user') THEN
        CREATE ROLE loadtest_user WITH LOGIN PASSWORD 'loadtest_secure_2024';
    END IF;
END
$$;

-- Grant permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO loadtest_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO loadtest_user;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO loadtest_user;

-- Set default privileges for future objects
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO loadtest_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO loadtest_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO loadtest_user;

-- Create configuration table for load testing parameters
CREATE TABLE IF NOT EXISTS load_test_config (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    config_name VARCHAR(255) UNIQUE NOT NULL,
    config_value JSONB NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insert default load test configurations
INSERT INTO load_test_config (config_name, config_value, description) VALUES
('concurrent_jobs_test', '{"concurrency": 100, "duration": 300, "job_type": "quick"}', 'Configuration for concurrent jobs load test'),
('throughput_test', '{"target_jobs_per_hour": 1000, "test_duration_minutes": 10, "job_type": "mixed"}', 'Configuration for throughput load test'),
('scaling_test', '{"initial_load": 50, "max_load": 200, "scaling_interval": 30, "monitoring_duration": 120}', 'Configuration for auto-scaling test'),
('stress_test', '{"duration": 300, "mixed_operations": true, "resource_monitoring": true}', 'Configuration for stress testing'),
('failure_recovery_test', '{"failure_scenarios": ["db_disconnect", "redis_disconnect", "memory_pressure", "container_failure"], "recovery_timeout": 30}', 'Configuration for failure recovery testing');

-- Create trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_load_test_config_updated_at
    BEFORE UPDATE ON load_test_config
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Optimize database for load testing
-- Increase work_mem for this session
SET work_mem = '256MB';

-- Create partial indexes for active data
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_jobs_active 
ON jobs(created_at, status) 
WHERE status IN ('queued', 'running');

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_runners_active 
ON runners(last_seen, status) 
WHERE status != 'offline';

-- Analyze tables for optimal query planning
ANALYZE jobs;
ANALYZE runners;
ANALYZE job_queue;
ANALYZE load_test_metrics;
ANALYZE scaling_events;

-- Log successful initialization
INSERT INTO load_test_metrics (
    test_run_id,
    metric_name,
    metric_value,
    metric_unit
) VALUES (
    'initialization',
    'database_initialized',
    1,
    'boolean'
);

COMMIT;