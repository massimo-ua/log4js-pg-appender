const { Client } = require('pg');
const testConfig = require('./config');

async function setupTestDatabase() {
  const client = new Client({
    ...testConfig,
    database: 'postgres', // Connect to default database first
  });
    
  await client.connect();
    
  // Create test database if it doesn't exist
  try {
    await client.query(`CREATE DATABASE ${testConfig.database}`);
  } catch (err) {
    if (err.code !== '42P04') { // 42P04 = database already exists
      throw err;
    }
  }
    
  await client.end();
    
  // Connect to test database and create table
  const testClient = new Client(testConfig);
  await testClient.connect();
    
  await testClient.query(`
      CREATE TABLE IF NOT EXISTS "${testConfig.tableName}" (
        "id" SERIAL PRIMARY KEY,
        "startTime" TIMESTAMP NOT NULL,
        "categoryName" VARCHAR(255) NOT NULL,
        "data" JSONB NOT NULL,
        "level" VARCHAR(10) NOT NULL,
        "context" JSONB
      )
    `);
    
  await testClient.end();
}
  
async function teardownTestDatabase() {
  const client = new Client({
    ...testConfig,
    database: 'postgres',
  });
    
  await client.connect();
    
  // Terminate all connections to the test database
  await client.query(`
      SELECT pg_terminate_backend(pg_stat_activity.pid)
      FROM pg_stat_activity
      WHERE pg_stat_activity.datname = '${testConfig.database}'
      AND pid <> pg_backend_pid()
    `);
    
  // Drop test database
  await client.query(`DROP DATABASE IF EXISTS ${testConfig.database}`);
    
  await client.end();
}
  
module.exports = {
  setupTestDatabase,
  teardownTestDatabase,
};
  