-- Create network isolation tracking table
CREATE TABLE IF NOT EXISTS network_isolation (
    network_id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    repository VARCHAR(255) NOT NULL,
    subnet CIDR NOT NULL,
    gateway INET NOT NULL,
    driver VARCHAR(50) DEFAULT 'bridge',
    internal BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_used TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    removed_at TIMESTAMP WITH TIME ZONE
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_network_isolation_repository ON network_isolation(repository);
CREATE INDEX IF NOT EXISTS idx_network_isolation_created_at ON network_isolation(created_at);
CREATE INDEX IF NOT EXISTS idx_network_isolation_last_used ON network_isolation(last_used);
CREATE INDEX IF NOT EXISTS idx_network_isolation_removed_at ON network_isolation(removed_at) WHERE removed_at IS NOT NULL;

-- Create container network associations table
CREATE TABLE IF NOT EXISTS container_network_associations (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    container_id VARCHAR(64) NOT NULL,
    network_id VARCHAR(64) NOT NULL,
    repository VARCHAR(255) NOT NULL,
    aliases TEXT[],
    attached_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    detached_at TIMESTAMP WITH TIME ZONE,
    FOREIGN KEY (network_id) REFERENCES network_isolation(network_id) ON DELETE CASCADE
);

-- Create indexes for associations
CREATE INDEX IF NOT EXISTS idx_container_network_container_id ON container_network_associations(container_id);
CREATE INDEX IF NOT EXISTS idx_container_network_network_id ON container_network_associations(network_id);
CREATE INDEX IF NOT EXISTS idx_container_network_repository ON container_network_associations(repository);
CREATE INDEX IF NOT EXISTS idx_container_network_attached_at ON container_network_associations(attached_at);
CREATE INDEX IF NOT EXISTS idx_container_network_active ON container_network_associations(container_id, network_id) WHERE detached_at IS NULL;

-- Create network isolation policies table
CREATE TABLE IF NOT EXISTS network_isolation_policies (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    repository_pattern VARCHAR(255),
    label_selectors JSONB,
    network_mode VARCHAR(50) DEFAULT 'isolated', -- isolated, shared, custom
    subnet_range CIDR,
    dns_servers TEXT[],
    allow_internet BOOLEAN DEFAULT false,
    allow_internal BOOLEAN DEFAULT true,
    custom_rules JSONB,
    priority INTEGER DEFAULT 100,
    enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by VARCHAR(255)
);

-- Create indexes for policies
CREATE INDEX IF NOT EXISTS idx_network_policies_repository_pattern ON network_isolation_policies(repository_pattern);
CREATE INDEX IF NOT EXISTS idx_network_policies_enabled ON network_isolation_policies(enabled);
CREATE INDEX IF NOT EXISTS idx_network_policies_priority ON network_isolation_policies(priority);

-- Create network isolation audit log
CREATE TABLE IF NOT EXISTS network_isolation_audit (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    action VARCHAR(50) NOT NULL, -- created, attached, detached, removed, cleanup
    network_id VARCHAR(64),
    container_id VARCHAR(64),
    repository VARCHAR(255),
    details JSONB,
    performed_by VARCHAR(255),
    ip_address INET,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for audit log
CREATE INDEX IF NOT EXISTS idx_network_audit_action ON network_isolation_audit(action);
CREATE INDEX IF NOT EXISTS idx_network_audit_network_id ON network_isolation_audit(network_id);
CREATE INDEX IF NOT EXISTS idx_network_audit_container_id ON network_isolation_audit(container_id);
CREATE INDEX IF NOT EXISTS idx_network_audit_repository ON network_isolation_audit(repository);
CREATE INDEX IF NOT EXISTS idx_network_audit_created_at ON network_isolation_audit(created_at);

-- Create network statistics view
CREATE OR REPLACE VIEW network_isolation_stats AS
SELECT 
    ni.repository,
    COUNT(DISTINCT ni.network_id) as network_count,
    COUNT(DISTINCT cna.container_id) FILTER (WHERE cna.detached_at IS NULL) as active_containers,
    MIN(ni.created_at) as first_network_created,
    MAX(ni.last_used) as last_activity,
    SUM(CASE WHEN ni.removed_at IS NULL THEN 1 ELSE 0 END) as active_networks,
    SUM(CASE WHEN ni.removed_at IS NOT NULL THEN 1 ELSE 0 END) as removed_networks
FROM network_isolation ni
LEFT JOIN container_network_associations cna ON ni.network_id = cna.network_id
GROUP BY ni.repository;

-- Function to cleanup orphaned networks
CREATE OR REPLACE FUNCTION cleanup_orphaned_networks(idle_minutes INTEGER DEFAULT 60)
RETURNS TABLE(network_id VARCHAR, repository VARCHAR, removed BOOLEAN) AS $$
DECLARE
    network RECORD;
    container_count INTEGER;
BEGIN
    FOR network IN 
        SELECT ni.network_id, ni.repository 
        FROM network_isolation ni
        WHERE ni.removed_at IS NULL
        AND ni.last_used < NOW() - (idle_minutes || ' minutes')::INTERVAL
    LOOP
        -- Check if network has active containers
        SELECT COUNT(*) INTO container_count
        FROM container_network_associations cna
        WHERE cna.network_id = network.network_id
        AND cna.detached_at IS NULL;
        
        IF container_count = 0 THEN
            -- Mark network as removed
            UPDATE network_isolation 
            SET removed_at = NOW()
            WHERE network_id = network.network_id;
            
            RETURN QUERY SELECT network.network_id, network.repository, true;
        ELSE
            RETURN QUERY SELECT network.network_id, network.repository, false;
        END IF;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Function to get network isolation report
CREATE OR REPLACE FUNCTION get_network_isolation_report(repo VARCHAR DEFAULT NULL)
RETURNS TABLE(
    repository VARCHAR,
    total_networks BIGINT,
    active_networks BIGINT,
    total_containers BIGINT,
    active_containers BIGINT,
    avg_containers_per_network NUMERIC,
    oldest_network_age INTERVAL,
    newest_network_age INTERVAL
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        ni.repository,
        COUNT(DISTINCT ni.network_id) as total_networks,
        COUNT(DISTINCT ni.network_id) FILTER (WHERE ni.removed_at IS NULL) as active_networks,
        COUNT(DISTINCT cna.container_id) as total_containers,
        COUNT(DISTINCT cna.container_id) FILTER (WHERE cna.detached_at IS NULL) as active_containers,
        ROUND(AVG(container_counts.container_count), 2) as avg_containers_per_network,
        MAX(NOW() - ni.created_at) as oldest_network_age,
        MIN(NOW() - ni.created_at) as newest_network_age
    FROM network_isolation ni
    LEFT JOIN container_network_associations cna ON ni.network_id = cna.network_id
    LEFT JOIN (
        SELECT network_id, COUNT(DISTINCT container_id) as container_count
        FROM container_network_associations
        GROUP BY network_id
    ) container_counts ON ni.network_id = container_counts.network_id
    WHERE (repo IS NULL OR ni.repository = repo)
    GROUP BY ni.repository
    ORDER BY ni.repository;
END;
$$ LANGUAGE plpgsql;

-- Add trigger to update last_used timestamp
CREATE OR REPLACE FUNCTION update_network_last_used()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND NEW.detached_at IS NULL) THEN
        UPDATE network_isolation 
        SET last_used = NOW()
        WHERE network_id = NEW.network_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_network_last_used_trigger
AFTER INSERT OR UPDATE ON container_network_associations
FOR EACH ROW
EXECUTE FUNCTION update_network_last_used();

-- Add comments
COMMENT ON TABLE network_isolation IS 'Tracks Docker networks created for repository isolation';
COMMENT ON TABLE container_network_associations IS 'Maps containers to their isolated networks';
COMMENT ON TABLE network_isolation_policies IS 'Defines network isolation policies per repository or pattern';
COMMENT ON TABLE network_isolation_audit IS 'Audit log for network isolation operations';
COMMENT ON VIEW network_isolation_stats IS 'Aggregated statistics for network isolation by repository';
COMMENT ON FUNCTION cleanup_orphaned_networks IS 'Cleanup networks without active containers';
COMMENT ON FUNCTION get_network_isolation_report IS 'Generate network isolation usage report';