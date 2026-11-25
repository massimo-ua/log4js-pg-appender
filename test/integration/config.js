const testConfig = {
  host: process.env.PGHOST || 'localhost',
  port: Number(process.env.PGPORT) || 5555,
  database: process.env.PGDATABASE || 'test_logs',
  user: process.env.PGUSER || 'test',
  password: process.env.PGPASSWORD || 'test',
  tableName: process.env.PG_TEST_TABLE || 'test',
};

module.exports = testConfig;
