const { Pool } = require('pg');

// Connect to default database first to create our database
const setupPool = new Pool({
    host: 'YOUR_SERVER_IP',
    port: 5433,
    user: 'app_user',
    password: 'app_secure_2024',
    database: 'postgres', // Connect to default database
    ssl: false
});

async function setupDatabase() {
    try {
        console.log('Setting up GitHub RunnerHub database...\n');
        
        // Check if database exists
        const dbResult = await setupPool.query(`
            SELECT datname FROM pg_database WHERE datname = 'github_runnerhub'
        `);
        
        if (dbResult.rows.length === 0) {
            console.log('Creating database github_runnerhub...');
            await setupPool.query('CREATE DATABASE github_runnerhub');
            console.log('✅ Database created');
        } else {
            console.log('✅ Database github_runnerhub already exists');
        }
        
        // Close setup connection
        await setupPool.end();
        
        // Now connect to the new database
        const pool = new Pool({
            connectionString: 'postgresql://user:password@host:5432/database
            ssl: false
        });
        
        // Create schema
        console.log('\nCreating schema...');
        await pool.query('CREATE SCHEMA IF NOT EXISTS runnerhub');
        console.log('✅ Schema created');
        
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
        
        // Create pools table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS runnerhub.pools (
                id VARCHAR(255) PRIMARY KEY,
                name VARCHAR(255) UNIQUE,
                min_runners INTEGER DEFAULT 1,
                max_runners INTEGER DEFAULT 10,
                current_size INTEGER DEFAULT 0,
                target_size INTEGER DEFAULT 0,
                scale_up_threshold FLOAT DEFAULT 0.8,
                scale_down_threshold FLOAT DEFAULT 0.2,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            )
        `);
        console.log('✅ Created pools table');
        
        // Create scaling_events table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS runnerhub.scaling_events (
                id SERIAL PRIMARY KEY,
                pool_id VARCHAR(255),
                event_type VARCHAR(50),
                from_size INTEGER,
                to_size INTEGER,
                reason TEXT,
                created_at TIMESTAMP DEFAULT NOW()
            )
        `);
        console.log('✅ Created scaling_events table');
        
        // Insert sample data
        console.log('\nInserting sample data...');
        
        // Insert sample pools
        await pool.query(`
            INSERT INTO runnerhub.pools (id, name, min_runners, max_runners, current_size)
            VALUES 
                ('pool-1', 'default-pool', 2, 10, 3),
                ('pool-2', 'high-performance-pool', 5, 20, 5)
            ON CONFLICT (id) DO NOTHING
        `);
        
        // Insert sample runners
        await pool.query(`
            INSERT INTO runnerhub.runners (id, name, type, status, last_heartbeat)
            VALUES 
                ('runner-1', 'runnerhub-proxy-1', 'proxy', 'idle', NOW()),
                ('runner-2', 'runnerhub-proxy-2', 'proxy', 'offline', NOW() - INTERVAL '10 minutes'),
                ('runner-3', 'runnerhub-ephemeral-1', 'ephemeral', 'busy', NOW()),
                ('runner-4', 'runnerhub-ephemeral-2', 'ephemeral', 'idle', NOW() - INTERVAL '30 seconds'),
                ('runner-5', 'runnerhub-ephemeral-3', 'ephemeral', 'idle', NOW() - INTERVAL '1 minute')
            ON CONFLICT (id) DO NOTHING
        `);
        
        // Insert sample jobs with varied timestamps for timeline
        const jobs = [];
        for (let i = 0; i < 50; i++) {
            const hoursAgo = Math.floor(Math.random() * 24);
            const startTime = `NOW() - INTERVAL '${hoursAgo} hours ${Math.floor(Math.random() * 60)} minutes'`;
            const duration = Math.floor(Math.random() * 10) + 1;
            const status = Math.random() > 0.1 ? 'completed' : 'failed';
            const repo = ['anubissbe/test-repo', 'anubissbe/web-app', 'anubissbe/api-service'][Math.floor(Math.random() * 3)];
            const workflow = ['CI Pipeline', 'Deploy', 'Tests', 'Build'][Math.floor(Math.random() * 4)];
            
            jobs.push(`(
                'job-${i}', 
                'job-${i}', 
                'run-${i}', 
                '${repo}', 
                '${workflow}', 
                '${status}', 
                ${startTime}, 
                ${startTime} + INTERVAL '${duration} minutes'
            )`);
        }
        
        // Add some pending and running jobs
        jobs.push(`('job-50', 'job-50', 'run-50', 'anubissbe/test-repo', 'Deploy', 'running', NOW() - INTERVAL '5 minutes', NULL)`);
        jobs.push(`('job-51', 'job-51', 'run-51', 'anubissbe/api-service', 'Tests', 'running', NOW() - INTERVAL '2 minutes', NULL)`);
        jobs.push(`('job-52', 'job-52', 'run-52', 'anubissbe/web-app', 'Build', 'pending', NULL, NULL)`);
        jobs.push(`('job-53', 'job-53', 'run-53', 'anubissbe/test-repo', 'CI Pipeline', 'pending', NULL, NULL)`);
        
        await pool.query(`
            INSERT INTO runnerhub.jobs (id, job_id, run_id, repository, workflow, status, started_at, completed_at)
            VALUES ${jobs.join(', ')}
            ON CONFLICT (id) DO NOTHING
        `);
        
        console.log('✅ Sample data inserted');
        
        // Create indexes for performance
        console.log('\nCreating indexes...');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_jobs_status ON runnerhub.jobs(status)');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON runnerhub.jobs(created_at)');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_runners_status ON runnerhub.runners(status)');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_runners_heartbeat ON runnerhub.runners(last_heartbeat)');
        console.log('✅ Indexes created');
        
        // Test queries
        console.log('\nVerifying data:');
        const jobCount = await pool.query('SELECT COUNT(*) FROM runnerhub.jobs');
        console.log(`  Jobs: ${jobCount.rows[0].count}`);
        
        const runnerCount = await pool.query('SELECT COUNT(*) FROM runnerhub.runners');
        console.log(`  Runners: ${runnerCount.rows[0].count}`);
        
        const poolCount = await pool.query('SELECT COUNT(*) FROM runnerhub.pools');
        console.log(`  Pools: ${poolCount.rows[0].count}`);
        
        console.log('\n✅ Database setup completed successfully!');
        console.log('\nYou can now run: node real-data-server.js');
        
        await pool.end();
        
    } catch (error) {
        console.error('❌ Database setup failed:', error.message);
        process.exit(1);
    }
}

setupDatabase();