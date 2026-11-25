const { Client } = require('pg');
const testConfig = require('./config');

function escapeIdentifier(str) {
  return `"${String(str).replace(/"/g, '""')}"`;
}

async function isDatabaseReachable() {
  const client = new Client({
    ...testConfig,
    database: 'postgres',
    connectionTimeoutMillis: 2000,
  });
  try {
    await client.connect();
    await client.end();
    return true;
  } catch {
    return false;
  }
}

async function setupTestDatabase() {
  const reachable = await isDatabaseReachable();
  if (!reachable) {
    throw new Error(
      `PostgreSQL is not reachable at ${testConfig.host}:${testConfig.port}. `
      + 'Run "npm run test:integration" or start PostgreSQL with "npm run test:db:up".'
    );
  }

  const client = new Client({
    ...testConfig,
    database: 'postgres',
  });

  await client.connect();

  try {
    await client.query(`CREATE DATABASE ${escapeIdentifier(testConfig.database)}`);
  } catch (err) {
    if (err.code !== '42P04') { // 42P04 = database already exists
      throw err;
    }
  } finally {
    await client.end();
  }

  const testClient = new Client(testConfig);
  await testClient.connect();

  try {
    await testClient.query(`
      CREATE TABLE IF NOT EXISTS ${escapeIdentifier(testConfig.tableName)} (
        "id" SERIAL PRIMARY KEY,
        "startTime" TIMESTAMP WITH TIME ZONE NOT NULL,
        "categoryName" VARCHAR(255) NOT NULL,
        "data" JSONB NOT NULL,
        "level" VARCHAR(20) NOT NULL,
        "context" JSONB
      )
    `);
  } finally {
    await testClient.end();
  }
}

async function teardownTestDatabase() {
  const reachable = await isDatabaseReachable();
  if (!reachable) {
    return;
  }

  const client = new Client({
    ...testConfig,
    database: 'postgres',
  });

  await client.connect();

  try {
    await client.query(
      `SELECT pg_terminate_backend(pg_stat_activity.pid)
        FROM pg_stat_activity
        WHERE pg_stat_activity.datname = $1
        AND pid <> pg_backend_pid()`,
      [testConfig.database]
    );

    await client.query(`DROP DATABASE IF EXISTS ${escapeIdentifier(testConfig.database)}`);
  } finally {
    await client.end();
  }
}

module.exports = {
  escapeIdentifier,
  isDatabaseReachable,
  setupTestDatabase,
  teardownTestDatabase,
};
