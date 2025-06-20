-- Create comprehensive audit logs table
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY,
    event_type VARCHAR(100) NOT NULL,
    category VARCHAR(50) NOT NULL,
    severity VARCHAR(20) NOT NULL,
    user_id VARCHAR(255),
    username VARCHAR(255),
    user_role VARCHAR(50),
    ip_address INET,
    user_agent TEXT,
    resource VARCHAR(100),
    resource_id VARCHAR(255),
    action TEXT NOT NULL,
    details JSONB,
    result VARCHAR(20) NOT NULL CHECK (result IN ('success', 'failure')),
    error_message TEXT,
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    correlation_id UUID
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_event_type ON audit_logs(event_type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_category ON audit_logs(category);
CREATE INDEX IF NOT EXISTS idx_audit_logs_severity ON audit_logs(severity);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_username ON audit_logs(username);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON audit_logs(resource, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_result ON audit_logs(result);
CREATE INDEX IF NOT EXISTS idx_audit_logs_correlation_id ON audit_logs(correlation_id);

-- Create composite indexes for common queries
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_timestamp ON audit_logs(user_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_category_timestamp ON audit_logs(category, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_severity_timestamp ON audit_logs(severity, timestamp DESC) WHERE severity IN ('error', 'critical');

-- Create audit summary view
CREATE OR REPLACE VIEW audit_summary AS
SELECT 
    DATE_TRUNC('hour', timestamp) as hour,
    category,
    severity,
    result,
    COUNT(*) as event_count,
    COUNT(DISTINCT user_id) as unique_users,
    COUNT(DISTINCT resource_id) as unique_resources
FROM audit_logs
WHERE timestamp >= NOW() - INTERVAL '7 days'
GROUP BY DATE_TRUNC('hour', timestamp), category, severity, result;

-- Create security events view
CREATE OR REPLACE VIEW security_audit_events AS
SELECT *
FROM audit_logs
WHERE category IN ('authentication', 'authorization', 'security')
   OR severity IN ('warning', 'error', 'critical')
   OR event_type IN (
       'user.login.failed',
       'security.unauthorized',
       'security.permission.denied',
       'security.suspicious',
       'security.rate.limit'
   )
ORDER BY timestamp DESC;

-- Create user activity view
CREATE OR REPLACE VIEW user_activity_summary AS
SELECT 
    user_id,
    username,
    COUNT(*) as total_actions,
    COUNT(CASE WHEN result = 'success' THEN 1 END) as successful_actions,
    COUNT(CASE WHEN result = 'failure' THEN 1 END) as failed_actions,
    COUNT(DISTINCT DATE_TRUNC('day', timestamp)) as active_days,
    MAX(timestamp) as last_activity,
    array_agg(DISTINCT category) as categories_accessed
FROM audit_logs
WHERE user_id IS NOT NULL
GROUP BY user_id, username;

-- Function to get audit statistics
CREATE OR REPLACE FUNCTION get_audit_statistics(
    p_start_date TIMESTAMP WITH TIME ZONE DEFAULT NOW() - INTERVAL '30 days',
    p_end_date TIMESTAMP WITH TIME ZONE DEFAULT NOW()
)
RETURNS TABLE(
    total_events BIGINT,
    unique_users BIGINT,
    failure_rate NUMERIC,
    top_event_types TEXT[],
    top_categories TEXT[],
    security_events BIGINT,
    critical_events BIGINT
) AS $$
BEGIN
    RETURN QUERY
    WITH stats AS (
        SELECT 
            COUNT(*) as total,
            COUNT(DISTINCT user_id) as users,
            COUNT(CASE WHEN result = 'failure' THEN 1 END)::NUMERIC / NULLIF(COUNT(*), 0) * 100 as fail_rate,
            COUNT(CASE WHEN category IN ('authentication', 'authorization', 'security') THEN 1 END) as sec_events,
            COUNT(CASE WHEN severity = 'critical' THEN 1 END) as crit_events
        FROM audit_logs
        WHERE timestamp BETWEEN p_start_date AND p_end_date
    ),
    top_events AS (
        SELECT array_agg(event_type ORDER BY count DESC) as types
        FROM (
            SELECT event_type, COUNT(*) as count
            FROM audit_logs
            WHERE timestamp BETWEEN p_start_date AND p_end_date
            GROUP BY event_type
            ORDER BY count DESC
            LIMIT 10
        ) t
    ),
    top_cats AS (
        SELECT array_agg(category ORDER BY count DESC) as cats
        FROM (
            SELECT category, COUNT(*) as count
            FROM audit_logs
            WHERE timestamp BETWEEN p_start_date AND p_end_date
            GROUP BY category
            ORDER BY count DESC
            LIMIT 5
        ) t
    )
    SELECT 
        stats.total,
        stats.users,
        ROUND(stats.fail_rate, 2),
        top_events.types,
        top_cats.cats,
        stats.sec_events,
        stats.crit_events
    FROM stats, top_events, top_cats;
END;
$$ LANGUAGE plpgsql;

-- Function to detect suspicious activity
CREATE OR REPLACE FUNCTION detect_suspicious_activity()
RETURNS TABLE(
    user_id VARCHAR,
    username VARCHAR,
    suspicious_pattern TEXT,
    event_count BIGINT,
    time_range INTERVAL
) AS $$
BEGIN
    -- Detect rapid failed login attempts
    RETURN QUERY
    SELECT 
        al.user_id,
        al.username,
        'Rapid failed login attempts' as suspicious_pattern,
        COUNT(*) as event_count,
        MAX(al.timestamp) - MIN(al.timestamp) as time_range
    FROM audit_logs al
    WHERE al.event_type = 'user.login.failed'
      AND al.timestamp >= NOW() - INTERVAL '1 hour'
    GROUP BY al.user_id, al.username
    HAVING COUNT(*) >= 5
       AND MAX(al.timestamp) - MIN(al.timestamp) < INTERVAL '10 minutes';

    -- Detect unusual access patterns
    RETURN QUERY
    SELECT 
        al.user_id,
        al.username,
        'Unusual access pattern - multiple IPs' as suspicious_pattern,
        COUNT(DISTINCT al.ip_address) as event_count,
        MAX(al.timestamp) - MIN(al.timestamp) as time_range
    FROM audit_logs al
    WHERE al.timestamp >= NOW() - INTERVAL '1 hour'
      AND al.user_id IS NOT NULL
    GROUP BY al.user_id, al.username
    HAVING COUNT(DISTINCT al.ip_address) >= 3;

    -- Detect excessive permission denials
    RETURN QUERY
    SELECT 
        al.user_id,
        al.username,
        'Excessive permission denials' as suspicious_pattern,
        COUNT(*) as event_count,
        MAX(al.timestamp) - MIN(al.timestamp) as time_range
    FROM audit_logs al
    WHERE al.event_type = 'security.permission.denied'
      AND al.timestamp >= NOW() - INTERVAL '1 hour'
    GROUP BY al.user_id, al.username
    HAVING COUNT(*) >= 10;
END;
$$ LANGUAGE plpgsql;

-- Function to cleanup old audit logs
CREATE OR REPLACE FUNCTION cleanup_audit_logs(retention_days INTEGER DEFAULT 90)
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM audit_logs
    WHERE timestamp < NOW() - (retention_days || ' days')::INTERVAL;
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    
    -- Log the cleanup operation
    INSERT INTO audit_logs (
        id, event_type, category, severity, action, 
        details, result, timestamp
    ) VALUES (
        gen_random_uuid(),
        'data.deleted',
        'data_management',
        'info',
        'Audit log cleanup',
        jsonb_build_object(
            'retention_days', retention_days,
            'deleted_count', deleted_count
        ),
        'success',
        NOW()
    );
    
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to auto-populate correlation IDs
CREATE OR REPLACE FUNCTION set_correlation_id()
RETURNS TRIGGER AS $$
BEGIN
    -- If correlation_id is not set and this is a related event, try to find parent
    IF NEW.correlation_id IS NULL AND NEW.resource_id IS NOT NULL THEN
        -- Look for recent related events
        SELECT correlation_id INTO NEW.correlation_id
        FROM audit_logs
        WHERE resource_id = NEW.resource_id
          AND resource = NEW.resource
          AND timestamp >= NEW.timestamp - INTERVAL '5 minutes'
          AND correlation_id IS NOT NULL
        ORDER BY timestamp DESC
        LIMIT 1;
        
        -- If no correlation found, this might be the start of a new correlation chain
        IF NEW.correlation_id IS NULL THEN
            NEW.correlation_id = NEW.id;
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_correlation_id_trigger
BEFORE INSERT ON audit_logs
FOR EACH ROW
EXECUTE FUNCTION set_correlation_id();

-- Add comments
COMMENT ON TABLE audit_logs IS 'Comprehensive audit log for all system activities';
COMMENT ON COLUMN audit_logs.event_type IS 'Specific event type (e.g., user.login, job.created)';
COMMENT ON COLUMN audit_logs.category IS 'Event category for grouping (e.g., authentication, job_management)';
COMMENT ON COLUMN audit_logs.severity IS 'Event severity level (info, warning, error, critical)';
COMMENT ON COLUMN audit_logs.correlation_id IS 'Groups related events together';
COMMENT ON VIEW security_audit_events IS 'View of security-related audit events';
COMMENT ON VIEW user_activity_summary IS 'Summary of user activities';
COMMENT ON FUNCTION detect_suspicious_activity IS 'Detects patterns of suspicious user activity';
COMMENT ON FUNCTION cleanup_audit_logs IS 'Removes audit logs older than retention period';