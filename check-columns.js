const { Pool } = require('pg');

const pool = new Pool({
    connectionString: 'postgresql://app_user:app_secure_2024@192.168.1.24:5433/github_runnerhub',
    ssl: false
});

async function checkColumns() {
    try {
        // Check jobs table columns
        const jobsColumns = await pool.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_schema = 'runnerhub' AND table_name = 'jobs'
            ORDER BY ordinal_position
        `);
        
        console.log('Jobs table columns:');
        jobsColumns.rows.forEach(row => {
            console.log(`  ${row.column_name}: ${row.data_type}`);
        });
        
        // Check runners table columns
        const runnersColumns = await pool.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_schema = 'runnerhub' AND table_name = 'runners'
            ORDER BY ordinal_position
        `);
        
        console.log('\nRunners table columns:');
        runnersColumns.rows.forEach(row => {
            console.log(`  ${row.column_name}: ${row.data_type}`);
        });
        
        // Test simple queries
        console.log('\nTesting simple queries:');
        const jobCount = await pool.query('SELECT COUNT(*) FROM runnerhub.jobs');
        console.log(`Jobs count: ${jobCount.rows[0].count}`);
        
        const sample = await pool.query('SELECT * FROM runnerhub.jobs LIMIT 1');
        console.log('\nSample job:', sample.rows[0]);
        
    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        await pool.end();
    }
}

checkColumns();