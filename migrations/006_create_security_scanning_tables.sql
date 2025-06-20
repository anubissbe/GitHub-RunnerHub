-- Create security scans table
CREATE TABLE IF NOT EXISTS security_scans (
    id UUID PRIMARY KEY,
    image_id VARCHAR(500) NOT NULL,
    image_name VARCHAR(255) NOT NULL,
    image_tag VARCHAR(128) NOT NULL,
    scan_date TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    scan_duration INTEGER NOT NULL, -- milliseconds
    vulnerabilities JSONB NOT NULL DEFAULT '[]',
    summary JSONB NOT NULL DEFAULT '{}',
    scan_engine VARCHAR(50) NOT NULL DEFAULT 'trivy',
    status VARCHAR(20) NOT NULL CHECK (status IN ('completed', 'failed', 'in_progress')),
    error_message TEXT,
    metadata JSONB
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_security_scans_image_id ON security_scans(image_id);
CREATE INDEX IF NOT EXISTS idx_security_scans_image_name ON security_scans(image_name, image_tag);
CREATE INDEX IF NOT EXISTS idx_security_scans_scan_date ON security_scans(scan_date DESC);
CREATE INDEX IF NOT EXISTS idx_security_scans_status ON security_scans(status);
CREATE INDEX IF NOT EXISTS idx_security_scans_critical ON security_scans((summary->>'critical')::int) WHERE status = 'completed';
CREATE INDEX IF NOT EXISTS idx_security_scans_high ON security_scans((summary->>'high')::int) WHERE status = 'completed';

-- Create security policies table
CREATE TABLE IF NOT EXISTS security_policies (
    id UUID PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,
    description TEXT,
    block_on_critical BOOLEAN NOT NULL DEFAULT true,
    block_on_high BOOLEAN NOT NULL DEFAULT false,
    max_critical INTEGER NOT NULL DEFAULT 0,
    max_high INTEGER NOT NULL DEFAULT 5,
    max_medium INTEGER NOT NULL DEFAULT 20,
    exempt_cves TEXT[],
    required_labels TEXT[],
    trusted_registries TEXT[],
    enabled BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create policy violations table
CREATE TABLE IF NOT EXISTS security_policy_violations (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    scan_id UUID NOT NULL REFERENCES security_scans(id) ON DELETE CASCADE,
    policy_id UUID NOT NULL REFERENCES security_policies(id) ON DELETE CASCADE,
    violations TEXT[] NOT NULL,
    blocked BOOLEAN NOT NULL DEFAULT false,
    override_reason TEXT,
    override_by VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for policy violations
CREATE INDEX IF NOT EXISTS idx_policy_violations_scan_id ON security_policy_violations(scan_id);
CREATE INDEX IF NOT EXISTS idx_policy_violations_policy_id ON security_policy_violations(policy_id);
CREATE INDEX IF NOT EXISTS idx_policy_violations_blocked ON security_policy_violations(blocked);
CREATE INDEX IF NOT EXISTS idx_policy_violations_created_at ON security_policy_violations(created_at DESC);

-- Create vulnerability database cache table
CREATE TABLE IF NOT EXISTS vulnerability_database (
    cve_id VARCHAR(50) PRIMARY KEY,
    severity VARCHAR(20) NOT NULL,
    title TEXT,
    description TEXT,
    cvss_score NUMERIC(3,1),
    cvss_vector TEXT,
    published_date TIMESTAMP WITH TIME ZONE,
    last_modified_date TIMESTAMP WITH TIME ZONE,
    references TEXT[],
    affected_packages JSONB,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for vulnerability database
CREATE INDEX IF NOT EXISTS idx_vuln_db_severity ON vulnerability_database(severity);
CREATE INDEX IF NOT EXISTS idx_vuln_db_cvss ON vulnerability_database(cvss_score DESC);
CREATE INDEX IF NOT EXISTS idx_vuln_db_published ON vulnerability_database(published_date DESC);
CREATE INDEX IF NOT EXISTS idx_vuln_db_updated ON vulnerability_database(updated_at DESC);

-- Create scan queue table
CREATE TABLE IF NOT EXISTS security_scan_queue (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    image_id VARCHAR(500) NOT NULL,
    priority INTEGER DEFAULT 5,
    requested_by VARCHAR(255),
    requested_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'scanning', 'completed', 'failed')),
    scan_id UUID REFERENCES security_scans(id),
    error_message TEXT
);

-- Create indexes for scan queue
CREATE INDEX IF NOT EXISTS idx_scan_queue_status ON security_scan_queue(status);
CREATE INDEX IF NOT EXISTS idx_scan_queue_priority ON security_scan_queue(priority DESC, requested_at ASC) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_scan_queue_image_id ON security_scan_queue(image_id);

-- Create security scan summary view
CREATE OR REPLACE VIEW security_scan_summary AS
SELECT 
    DATE_TRUNC('day', scan_date) as scan_day,
    COUNT(*) as total_scans,
    COUNT(CASE WHEN status = 'completed' THEN 1 END) as successful_scans,
    COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_scans,
    AVG(CASE WHEN status = 'completed' THEN scan_duration END) as avg_scan_duration,
    SUM((summary->>'total')::int) as total_vulnerabilities,
    SUM((summary->>'critical')::int) as critical_vulnerabilities,
    SUM((summary->>'high')::int) as high_vulnerabilities,
    SUM((summary->>'fixable')::int) as fixable_vulnerabilities
FROM security_scans
GROUP BY DATE_TRUNC('day', scan_date)
ORDER BY scan_day DESC;

-- Create vulnerable images view
CREATE OR REPLACE VIEW vulnerable_images AS
SELECT 
    image_name,
    image_tag,
    MAX(scan_date) as last_scan_date,
    MAX((summary->>'critical')::int) as critical_count,
    MAX((summary->>'high')::int) as high_count,
    MAX((summary->>'medium')::int) as medium_count,
    MAX((summary->>'total')::int) as total_vulnerabilities,
    COUNT(*) as scan_count
FROM security_scans
WHERE status = 'completed'
GROUP BY image_name, image_tag
HAVING MAX((summary->>'critical')::int) > 0 OR MAX((summary->>'high')::int) > 0
ORDER BY critical_count DESC, high_count DESC;

-- Create function to get vulnerability trends
CREATE OR REPLACE FUNCTION get_vulnerability_trends(
    p_days INTEGER DEFAULT 30,
    p_image_name VARCHAR DEFAULT NULL
)
RETURNS TABLE(
    scan_date DATE,
    avg_critical NUMERIC,
    avg_high NUMERIC,
    avg_medium NUMERIC,
    avg_low NUMERIC,
    scan_count BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        DATE_TRUNC('day', s.scan_date)::DATE as scan_date,
        AVG((s.summary->>'critical')::int)::NUMERIC as avg_critical,
        AVG((s.summary->>'high')::int)::NUMERIC as avg_high,
        AVG((s.summary->>'medium')::int)::NUMERIC as avg_medium,
        AVG((s.summary->>'low')::int)::NUMERIC as avg_low,
        COUNT(*) as scan_count
    FROM security_scans s
    WHERE s.status = 'completed'
      AND s.scan_date >= NOW() - (p_days || ' days')::INTERVAL
      AND (p_image_name IS NULL OR s.image_name = p_image_name)
    GROUP BY DATE_TRUNC('day', s.scan_date)
    ORDER BY scan_date;
END;
$$ LANGUAGE plpgsql;

-- Create function to check policy compliance
CREATE OR REPLACE FUNCTION check_policy_compliance(
    p_scan_id UUID,
    p_policy_id UUID
)
RETURNS TABLE(
    compliant BOOLEAN,
    violations TEXT[],
    critical_count INTEGER,
    high_count INTEGER,
    medium_count INTEGER
) AS $$
DECLARE
    v_scan RECORD;
    v_policy RECORD;
    v_violations TEXT[] := ARRAY[]::TEXT[];
    v_compliant BOOLEAN := true;
BEGIN
    -- Get scan result
    SELECT * INTO v_scan FROM security_scans WHERE id = p_scan_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Scan not found: %', p_scan_id;
    END IF;
    
    -- Get policy
    SELECT * INTO v_policy FROM security_policies WHERE id = p_policy_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Policy not found: %', p_policy_id;
    END IF;
    
    -- Extract counts
    critical_count := (v_scan.summary->>'critical')::int;
    high_count := (v_scan.summary->>'high')::int;
    medium_count := (v_scan.summary->>'medium')::int;
    
    -- Check critical vulnerabilities
    IF v_policy.block_on_critical AND critical_count > 0 THEN
        v_violations := array_append(v_violations, 
            format('Found %s critical vulnerabilities (policy blocks any)', critical_count));
        v_compliant := false;
    ELSIF critical_count > v_policy.max_critical THEN
        v_violations := array_append(v_violations, 
            format('Found %s critical vulnerabilities (max allowed: %s)', critical_count, v_policy.max_critical));
        v_compliant := false;
    END IF;
    
    -- Check high vulnerabilities
    IF v_policy.block_on_high AND high_count > 0 THEN
        v_violations := array_append(v_violations, 
            format('Found %s high vulnerabilities (policy blocks any)', high_count));
        v_compliant := false;
    ELSIF high_count > v_policy.max_high THEN
        v_violations := array_append(v_violations, 
            format('Found %s high vulnerabilities (max allowed: %s)', high_count, v_policy.max_high));
        v_compliant := false;
    END IF;
    
    -- Check medium vulnerabilities
    IF medium_count > v_policy.max_medium THEN
        v_violations := array_append(v_violations, 
            format('Found %s medium vulnerabilities (max allowed: %s)', medium_count, v_policy.max_medium));
        v_compliant := false;
    END IF;
    
    RETURN QUERY SELECT v_compliant, v_violations, critical_count, high_count, medium_count;
END;
$$ LANGUAGE plpgsql;

-- Create function to get common vulnerabilities
CREATE OR REPLACE FUNCTION get_common_vulnerabilities(
    p_days INTEGER DEFAULT 30,
    p_limit INTEGER DEFAULT 20
)
RETURNS TABLE(
    vulnerability_id VARCHAR,
    severity VARCHAR,
    occurrence_count BIGINT,
    affected_images BIGINT,
    first_seen TIMESTAMP WITH TIME ZONE,
    last_seen TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        vuln->>'vulnerabilityId' as vulnerability_id,
        vuln->>'severity' as severity,
        COUNT(*) as occurrence_count,
        COUNT(DISTINCT s.image_id) as affected_images,
        MIN(s.scan_date) as first_seen,
        MAX(s.scan_date) as last_seen
    FROM security_scans s,
        LATERAL jsonb_array_elements(s.vulnerabilities) as vuln
    WHERE s.status = 'completed'
      AND s.scan_date >= NOW() - (p_days || ' days')::INTERVAL
    GROUP BY vuln->>'vulnerabilityId', vuln->>'severity'
    ORDER BY occurrence_count DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- Add trigger to update policy updated_at
CREATE OR REPLACE FUNCTION update_policy_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_security_policies_timestamp
BEFORE UPDATE ON security_policies
FOR EACH ROW
EXECUTE FUNCTION update_policy_timestamp();

-- Add comments
COMMENT ON TABLE security_scans IS 'Container image vulnerability scan results';
COMMENT ON TABLE security_policies IS 'Security policies for vulnerability thresholds';
COMMENT ON TABLE security_policy_violations IS 'Policy violations detected during scans';
COMMENT ON TABLE vulnerability_database IS 'Cached vulnerability information';
COMMENT ON TABLE security_scan_queue IS 'Queue for pending security scans';
COMMENT ON VIEW security_scan_summary IS 'Daily summary of security scans';
COMMENT ON VIEW vulnerable_images IS 'Images with critical or high vulnerabilities';
COMMENT ON FUNCTION get_vulnerability_trends IS 'Get vulnerability trends over time';
COMMENT ON FUNCTION check_policy_compliance IS 'Check if scan results comply with policy';
COMMENT ON FUNCTION get_common_vulnerabilities IS 'Get most common vulnerabilities';