-- Migration: Add routing rules and decisions tables
-- Version: 003
-- Description: Support for label-based job routing

-- Create routing rules table
CREATE TABLE IF NOT EXISTS runnerhub.routing_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    priority INTEGER NOT NULL DEFAULT 0,
    conditions JSONB NOT NULL DEFAULT '{}',
    targets JSONB NOT NULL DEFAULT '{}',
    enabled BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create routing decisions table for analytics
CREATE TABLE IF NOT EXISTS runnerhub.routing_decisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES runnerhub.jobs(id) ON DELETE CASCADE,
    rule_id UUID REFERENCES runnerhub.routing_rules(id) ON DELETE SET NULL,
    target_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX idx_routing_rules_priority ON runnerhub.routing_rules(priority DESC, created_at ASC) WHERE enabled = true;
CREATE INDEX idx_routing_rules_conditions ON runnerhub.routing_rules USING gin(conditions);
CREATE INDEX idx_routing_decisions_job_id ON runnerhub.routing_decisions(job_id);
CREATE INDEX idx_routing_decisions_rule_id ON runnerhub.routing_decisions(rule_id);
CREATE INDEX idx_routing_decisions_created_at ON runnerhub.routing_decisions(created_at);

-- Comments
COMMENT ON TABLE runnerhub.routing_rules IS 'Defines rules for routing jobs to specific runners based on labels and conditions';
COMMENT ON TABLE runnerhub.routing_decisions IS 'Records routing decisions for analytics and debugging';

COMMENT ON COLUMN runnerhub.routing_rules.priority IS 'Higher priority rules are evaluated first';
COMMENT ON COLUMN runnerhub.routing_rules.conditions IS 'JSON object with labels, repository, workflow, branch, event conditions';
COMMENT ON COLUMN runnerhub.routing_rules.targets IS 'JSON object with runnerLabels, poolOverride, exclusive settings';

-- Sample routing rules for testing
INSERT INTO runnerhub.routing_rules (name, priority, conditions, targets) VALUES
-- GPU jobs go to GPU runners
('GPU Workloads', 100, 
 '{"labels": ["gpu", "cuda"]}',
 '{"runnerLabels": ["gpu-enabled", "cuda-12"], "exclusive": false}'
),
-- Production jobs require secure runners
('Production Jobs', 90,
 '{"repository": "*/production", "branch": "main"}',
 '{"runnerLabels": ["secure", "production"], "exclusive": true}'
),
-- Large jobs need high-memory runners
('High Memory Jobs', 80,
 '{"labels": ["large", "memory-intensive"]}',
 '{"runnerLabels": ["xlarge", "high-memory"], "exclusive": false}'
),
-- Windows builds
('Windows Builds', 70,
 '{"labels": ["windows", "win32"]}',
 '{"runnerLabels": ["windows", "windows-latest"], "poolOverride": "windows-pool"}'
);