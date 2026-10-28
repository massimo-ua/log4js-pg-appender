// test/appender.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { setupTestDatabase, teardownTestDatabase } = require('./setup');
const testConfig = require('./config');
const { Client } = require('pg');
const appender = require('../lib/appender');
const db = require('../lib/db');

test('PostgreSQL Appender Integration', async (t) => {
  const isAvailable = await setupTestDatabase();
  if (!isAvailable) {
    t.skip('Skipping live integration tests: PostgreSQL is not reachable at localhost:5555');
    return;
  }

  t.afterEach(async () => {
    // Clean up database records after each test
    const client = new Client(testConfig);
    await client.connect();
    await client.query(`TRUNCATE TABLE "${testConfig.tableName}"`);
    await client.end();
    db.disconnect();
  });

  t.after(async () => {
    // Teardown test database
    await teardownTestDatabase();
  });

  await t.test('configuration validation', async (t) => {
    await t.test('should throw error when config is missing', () => {
      assert.throws(
        () => appender.configure(),
        /config is required/
      );
    });
  });

  await t.test('logging functionality', async (t) => {
    await t.test('should write log entry to database', async () => {
      const pgAppender = appender.configure({
        ...testConfig,
        schema: null, // Test table was created in default public without schema qualification
      });
      const testEvent = {
        startTime: new Date(),
        categoryName: 'test-category',
        data: { message: 'test message' },
        level: { levelStr: 'INFO' },
        context: { user: 'testuser' },
      };

      pgAppender(testEvent);

      // Wait a bit for async operation to complete
      await new Promise(resolve => setTimeout(resolve, 100));

      const client = new Client(testConfig);
      await client.connect();

      const result = await client.query(
        `SELECT * FROM "${testConfig.tableName}" WHERE "categoryName" = $1`,
        ['test-category']
      );

      assert.equal(result.rows.length, 1);
      assert.equal(result.rows[0].level, 'INFO');
      const data = result.rows[0].data;
      const context = result.rows[0].context;

      assert.deepEqual(typeof data === 'string' ? JSON.parse(data) : data, { message: 'test message' });
      assert.deepEqual(typeof context === 'string' ? JSON.parse(context) : context, { user: 'testuser' });

      await client.end();
      await pgAppender.shutdown();
    });

    await t.test('should handle null context', async () => {
      const pgAppender = appender.configure({
        ...testConfig,
        schema: null,
      });
      const testEvent = {
        startTime: new Date(),
        categoryName: 'test-category',
        data: { message: 'test message' },
        level: { levelStr: 'INFO' },
        context: null,
      };

      pgAppender(testEvent);

      await new Promise(resolve => setTimeout(resolve, 100));

      const client = new Client(testConfig);
      await client.connect();

      const result = await client.query(
        `SELECT * FROM "${testConfig.tableName}" WHERE "categoryName" = $1`,
        ['test-category']
      );

      assert.equal(result.rows.length, 1);
      assert.equal(result.rows[0].context, null);

      await client.end();
      await pgAppender.shutdown();
    });
  });

  await t.test('database connection', async (t) => {
    await t.test('should reuse existing connection in legacy db client', async () => {
      const firstConnection = db.connect(testConfig);
      const secondConnection = db.connect(testConfig);

      assert.strictEqual(firstConnection, secondConnection);
    });

    await t.test('should handle disconnect properly in legacy db client', async () => {
      const connection = db.connect(testConfig);
      db.disconnect();

      await assert.rejects(
        async () => {
          await connection.query('SELECT 1');
        },
        {
          message: /Client was closed and is not queryable/,
        }
      );
    });
  });
});
