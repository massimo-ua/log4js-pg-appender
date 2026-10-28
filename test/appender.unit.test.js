const test = require('node:test');
const assert = require('node:assert/strict');
const appender = require('../lib/appender');
const db = require('../lib/db');

test('Appender Unit Tests', async (t) => {
  await t.test('configuration validation', async (t) => {
    await t.test('should throw error when config is missing', () => {
      assert.throws(
        () => appender.configure(),
        /config is required/
      );
      assert.throws(
        () => appender.configure(null),
        /config is required/
      );
      assert.throws(
        () => appender.configure('invalid'),
        /config is required/
      );
    });

    await t.test('should throw error when tableName is invalid', () => {
      assert.throws(
        () => appender.configure({ tableName: 123 }),
        /tableName must be a string/
      );
    });

    await t.test('should throw error when schema is invalid', () => {
      assert.throws(
        () => appender.configure({ schema: 123 }),
        /schema must be a string or null/
      );
    });

    await t.test('should throw error when onError is not a function', () => {
      assert.throws(
        () => appender.configure({ onError: 'not-a-func' }),
        /onError must be a function/
      );
    });

    await t.test('should accept connectionString without throwing', () => {
      const pgAppender = appender.configure({
        connectionString: 'postgresql://usr:pwd@localhost:5432/testdb',
      });
      assert.equal(typeof pgAppender, 'function');
      assert.equal(typeof pgAppender.shutdown, 'function');
      pgAppender.shutdown();
    });

    await t.test('should accept individual connection options without throwing', () => {
      const pgAppender = appender.configure({
        host: 'localhost',
        database: 'testdb',
        user: 'testuser',
        password: 'secret',
        port: 5432,
      });
      assert.equal(typeof pgAppender, 'function');
      assert.equal(typeof pgAppender.shutdown, 'function');
      pgAppender.shutdown();
    });

    await t.test('should accept minimal config and apply defaults', () => {
      const pgAppender = appender.configure({});
      assert.equal(typeof pgAppender, 'function');
      assert.equal(typeof pgAppender.shutdown, 'function');
      pgAppender.shutdown();
    });
  });

  await t.test('appender instance lifecycle and isolation', async () => {
    const appender1 = appender.configure({ tableName: 'table1' });
    const appender2 = appender.configure({ tableName: 'table2' });

    assert.notStrictEqual(appender1.pool, appender2.pool);

    let shutdown1Called = false;
    let shutdown2Called = false;

    await new Promise((resolve) => {
      appender1.shutdown(() => {
        shutdown1Called = true;
        resolve();
      });
    });

    await new Promise((resolve) => {
      appender2.shutdown(() => {
        shutdown2Called = true;
        resolve();
      });
    });

    assert.ok(shutdown1Called);
    assert.ok(shutdown2Called);
  });

  await t.test('logging execution with mock pool', async (t) => {
    await t.test('should format and write log entry', async () => {
      let executedQuery = null;

      // Create appender and mock the pool query
      const pgAppender = appender.configure({ tableName: 'logs' });
      pgAppender.pool.query = async (query) => {
        executedQuery = query;
        return { rows: [] };
      };

      const logEvent = {
        startTime: new Date('2026-01-01T00:00:00Z'),
        categoryName: 'test-category',
        data: ['hello', { detail: 'world' }],
        level: { levelStr: 'INFO' },
        context: { requestId: 'req-123' },
      };

      pgAppender(logEvent);

      // Wait a microtask tick for async writer
      await new Promise(resolve => setTimeout(resolve, 20));

      assert.ok(executedQuery);
      assert.equal(executedQuery.name, 'log4js-pg-public_logs');
      assert.equal(
        executedQuery.text,
        'INSERT INTO "public"."logs" ("startTime", "categoryName", "data", "level", "context") VALUES($1, $2, $3, $4, $5)'
      );
      assert.equal(executedQuery.values[1], 'test-category');
      assert.equal(executedQuery.values[2], '["hello",{"detail":"world"}]');
      assert.equal(executedQuery.values[3], 'INFO');
      assert.equal(executedQuery.values[4], '{"requestId":"req-123"}');

      await pgAppender.shutdown();
    });

    await t.test('should safely handle circular references in data and context', async () => {
      let executedQuery = null;

      const pgAppender = appender.configure({ tableName: 'logs' });
      pgAppender.pool.query = async (query) => {
        executedQuery = query;
        return { rows: [] };
      };

      const circularData = { key: 'value' };
      circularData.self = circularData;

      const circularContext = { user: 'admin' };
      circularContext.loop = circularContext;

      pgAppender({
        startTime: new Date(),
        categoryName: 'circular-test',
        data: circularData,
        level: { levelStr: 'WARN' },
        context: circularContext,
      });

      await new Promise(resolve => setTimeout(resolve, 20));

      assert.ok(executedQuery);
      assert.equal(executedQuery.values[2], '{"key":"value","self":"[Circular]"}');
      assert.equal(executedQuery.values[4], '{"user":"admin","loop":"[Circular]"}');

      await pgAppender.shutdown();
    });

    await t.test('should route query errors to onError handler', async () => {
      let capturedError = null;
      let capturedEvent = null;

      const dbError = new Error('Database connection failed');
      const pgAppender = appender.configure({
        onError: (err, event) => {
          capturedError = err;
          capturedEvent = event;
        },
      });

      pgAppender.pool.query = async () => {
        throw dbError;
      };

      const testEvent = {
        startTime: new Date(),
        categoryName: 'error-test',
        data: 'test',
        level: { levelStr: 'ERROR' },
      };

      pgAppender(testEvent);

      await new Promise(resolve => setTimeout(resolve, 20));

      assert.strictEqual(capturedError, dbError);
      assert.strictEqual(capturedEvent, testEvent);

      await pgAppender.shutdown();
    });

    await t.test('should gracefully handle null/undefined loggingEvent', () => {
      const pgAppender = appender.configure({});
      assert.doesNotThrow(() => {
        pgAppender(null);
        pgAppender(undefined);
      });
      pgAppender.shutdown();
    });
  });

  await t.test('database backward compatibility module', async () => {
    const legacyConn1 = db.connect({ host: 'localhost' });
    const legacyConn2 = db.connect({ host: 'localhost' });
    assert.strictEqual(legacyConn1, legacyConn2);
    db.disconnect();
  });
});
