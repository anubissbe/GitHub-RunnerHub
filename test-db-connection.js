const { Pool } = require('pg');

const pool = new Pool({
    connectionString: 'postgresql://app_user:app_secure_2024@192.168.1.24:5433/github_runnerhub',
    ssl: false
});

async function testDatabase() {
    try {
        console.log('Testing database connection...\n');
        
        // Test connection
        const timeResult = await pool.query('SELECT NOW()');
        console.log('✅ Connected to database at:', timeResult.rows[0].now);
        
        // Check if schema exists
        const schemaResult = await pool.query(`
            SELECT schema_name 
            FROM information_schema.schemata 
            WHERE schema_name = 'runnerhub'
        `);
        
        if (schemaResult.rows.length === 0) {
            console.log('\n❌ Schema "runnerhub" does not exist');
            console.log('Creating schema...');
            
            await pool.query('CREATE SCHEMA IF NOT EXISTS runnerhub');
            console.log('✅ Schema created');
        } else {
            console.log('\n✅ Schema "runnerhub" exists');
        }
        
        // Check tables
        const tablesResult = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'runnerhub' 
            ORDER BY table_name
        `);
        
        console.log('\nExisting tables:');
        if (tablesResult.rows.length === 0) {
            console.log('  No tables found');
            
            // Create tables
            console.log('\nCreating tables...');
            
            // Create jobs table
            await pool.query(`
                CREATE TABLE IF NOT EXISTS runnerhub.jobs (
                    id VARCHAR(255) PRIMARY KEY,
                    job_id VARCHAR(255),
                    run_id VARCHAR(255),
                    repository VARCHAR(255),
                    workflow VARCHAR(255),
                    status VARCHAR(50) DEFAULT 'pending',
                    runner_name VARCHAR(255),
                    assigned_runner_id VARCHAR(255),
                    started_at TIMESTAMP,
                    completed_at TIMESTAMP,
                    error TEXT,
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW()
                )
            `);
            console.log('✅ Created jobs table');
            
            // Create runners table
            await pool.query(`
                CREATE TABLE IF NOT EXISTS runnerhub.runners (
                    id VARCHAR(255) PRIMARY KEY,
                    name VARCHAR(255) UNIQUE,
                    type VARCHAR(50) DEFAULT 'ephemeral',
                    status VARCHAR(50) DEFAULT 'idle',
                    repository VARCHAR(255),
                    last_heartbeat TIMESTAMP DEFAULT NOW(),
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW()
                )
            `);
            console.log('✅ Created runners table');
            
            // Insert some sample data
            console.log('\nInserting sample data...');
            
            // Insert sample runners
            await pool.query(`
                INSERT INTO runnerhub.runners (id, name, type, status, last_heartbeat)
                VALUES 
                    ('runner-1', 'runnerhub-proxy-1', 'proxy', 'idle', NOW()),
                    ('runner-2', 'runnerhub-proxy-2', 'proxy', 'offline', NOW() - INTERVAL '10 minutes'),
                    ('runner-3', 'runnerhub-ephemeral-1', 'ephemeral', 'busy', NOW())
                ON CONFLICT (id) DO NOTHING
            `);
            
            // Insert sample jobs
            await pool.query(`
                INSERT INTO runnerhub.jobs (id, job_id, run_id, repository, workflow, status, started_at, completed_at)
                VALUES 
                    ('job-1', 'job-1', 'run-1', 'anubissbe/test-repo', 'CI Pipeline', 'completed', NOW() - INTERVAL '1 hour', NOW() - INTERVAL '55 minutes'),
                    ('job-2', 'job-2', 'run-2', 'anubissbe/another-repo', 'Deploy', 'running', NOW() - INTERVAL '5 minutes', NULL),
                    ('job-3', 'job-3', 'run-3', 'anubissbe/test-repo', 'Tests', 'failed', NOW() - INTERVAL '2 hours', NOW() - INTERVAL '1 hour 50 minutes'),
                    ('job-4', 'job-4', 'run-4', 'anubissbe/web-app', 'Build', 'pending', NULL, NULL)
                ON CONFLICT (id) DO NOTHING
            `);
            
            console.log('✅ Sample data inserted');
        } else {
            tablesResult.rows.forEach(row => {
                console.log(`  - ${row.table_name}`);
            });
        }
        
        // Test queries
        console.log('\nTesting queries:');
        
        const jobCount = await pool.query('SELECT COUNT(*) FROM runnerhub.jobs');
        console.log(`  Jobs: ${jobCount.rows[0].count}`);
        
        const runnerCount = await pool.query('SELECT COUNT(*) FROM runnerhub.runners');
        console.log(`  Runners: ${runnerCount.rows[0].count}`);
        
        console.log('\n✅ Database test completed successfully!');
        
    } catch (error) {
        console.error('❌ Database test failed:', error.message);
    } finally {
        await pool.end();
    }
}

testDatabase();