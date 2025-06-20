const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://app_user:app_secure_2024@192.168.1.24:5433/github_runnerhub',
    ssl: false
});

async function debugDb() {
    try {
        console.log('DATABASE_URL:', process.env.DATABASE_URL);
        
        // Test basic connection
        const result = await pool.query('SELECT current_database(), current_user');
        console.log('Connected to database:', result.rows[0]);
        
        // Check schemas
        const schemas = await pool.query('SELECT schema_name FROM information_schema.schemata WHERE schema_name = $1', ['runnerhub']);
        console.log('Schema exists:', schemas.rows.length > 0);
        
        // Check tables
        const tables = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'runnerhub'
        `);
        console.log('Tables:', tables.rows.map(r => r.table_name));
        
        // Test the problematic query
        const testQuery = `
            SELECT 
                COUNT(*) as total,
                COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending,
                COUNT(CASE WHEN status = 'running' THEN 1 END) as running,
                COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
                COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed
            FROM runnerhub.jobs
            WHERE created_at >= NOW() - INTERVAL '24 hours'
        `;
        
        const result2 = await pool.query(testQuery);
        console.log('Job stats:', result2.rows[0]);
        
    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        await pool.end();
    }
}

debugDb();