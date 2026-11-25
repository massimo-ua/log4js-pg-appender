const test = require('node:test');
const assert = require('node:assert/strict');
const log4js = require('log4js');
const appender = require('../lib/appender');
const db = require('../lib/db');

test('Appender Unit Tests', async (t) => {
  await t.test('configuration validation', async (t) => {
    await t.test('should throw error when config is missing or an array', () => {
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
      assert.throws(
        () => appender.configure([]),
        /config is required/
      );
    });

    await t.test('should throw error when tableName is invalid', () => {
      assert.throws(
        () => appender.configure({ tableName: 123 }),
        /tableName must be a string/
      );
      assert.throws(
        () => appender.configure({ tableName: '' }),
        /tableName must be a non-empty string/
      );
      assert.throws(
        () => appender.configure({ tableName: '   ' }),
        /tableName must be a non-empty string/
      );
      assert.throws(
        () => appender.configure({ tableName: 'logs\0drop' }),
        /tableName must not contain null bytes/
      );
      assert.throws(
        () => appender.configure({ tableName: '.logs' }),
        /schema must be a non-empty string/
      );
      assert.throws(
        () => appender.configure({ tableName: 'public.' }),
        /tableName must be a non-empty string/
      );
    });

    await t.test('should throw error when schema is invalid', () => {
      assert.throws(
        () => appender.configure({ schema: 123 }),
        /schema must be a string or null/
      );
      assert.throws(
        () => appender.configure({ schema: '' }),
        /schema must be a non-empty string/
      );
      assert.throws(
        () => appender.configure({ schema: '   ' }),
        /schema must be a non-empty string/
      );
      assert.throws(
        () => appender.configure({ schema: 'pub\0lic' }),
        /schema must not contain null bytes/
      );
    });

    await t.test('should throw error when maxPendingWrites is invalid', () => {
      for (const bad of [0, -1, 1.5, '10', NaN, null]) {
        assert.throws(
          () => appender.configure({ maxPendingWrites: bad }),
          /maxPendingWrites must be a positive integer or Infinity/
        );
      }
    });

    await t.test('should throw error when onError is not a function', () => {
      assert.throws(
        () => appender.configure({ onError: 'not-a-func' }),
        /onError must be a function/
      );
    });

    await t.test('should throw error when columns is invalid', () => {
      assert.throws(
        () => appender.configure({ columns: null }),
        /columns must be a plain object/
      );
      assert.throws(
        () => appender.configure({ columns: [] }),
        /columns must be a plain object/
      );
      assert.throws(
        () => appender.configure({ columns: {} }),
        /columns must define at least one column/
      );
      assert.throws(
        () => appender.configure({ columns: { created_at: 123 } }),
        /column "created_at" mapping must be a non-empty string or function/
      );
    });

    await t.test('should export DEFAULT_COLUMNS from appender and package root', () => {
      const rootPkg = require('../index');
      assert.strictEqual(rootPkg.DEFAULT_COLUMNS, appender.DEFAULT_COLUMNS);
      assert.ok(Object.isFrozen(appender.DEFAULT_COLUMNS));
      assert.deepEqual(appender.DEFAULT_COLUMNS, {
        startTime: 'startTime',
        categoryName: 'categoryName',
        data: 'data',
        level: 'level',
        context: 'context',
      });
    });

    await t.test('should strip columns and maxPendingWrites from pg.Pool options and hide connectionString', async () => {
      const connStr = 'postgresql://usr:supersecret@localhost:5432/testdb';
      const pgAppender = appender.configure({
        connectionString: connStr,
        columns: { created_at: 'startTime' },
        maxPendingWrites: 500,
      });
      assert.equal(pgAppender.pool.options.columns, undefined);
      assert.equal(pgAppender.pool.options.maxPendingWrites, undefined);
      assert.equal(pgAppender.pool.options.connectionString, connStr);
      assert.equal(Object.keys(pgAppender.pool.options).includes('connectionString'), false);
      assert.equal(JSON.stringify(pgAppender.pool.options).includes('supersecret'), false);
      await pgAppender.shutdown();
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

    await t.test('should write custom mapped columns including built-ins, dot-paths, and functions', async () => {
      let executedQuery = null;

      const pgAppender = appender.configure({
        tableName: 'app_logs',
        columns: {
          created_at: 'startTime',
          severity: 'level',
          level_num: 'level.level',
          request_id: 'context.requestId',
          user_id: 'data.1.userId',
          message: (event) => event.data[0],
          service: () => 'auth-api',
          extra: 'context.missing',
        },
      });

      pgAppender.pool.query = async (query) => {
        executedQuery = query;
        return { rows: [] };
      };

      const ts = new Date('2026-06-01T10:00:00Z');
      pgAppender({
        startTime: ts,
        categoryName: 'auth',
        data: ['User logged in', { userId: 42 }],
        level: { level: 20000, levelStr: 'INFO' },
        context: { requestId: 'req-999' },
      });

      await new Promise(resolve => setTimeout(resolve, 20));

      assert.ok(executedQuery);
      assert.equal(
        executedQuery.text,
        'INSERT INTO "public"."app_logs" ("created_at", "severity", "level_num", "request_id", "user_id", "message", "service", "extra") VALUES($1, $2, $3, $4, $5, $6, $7, $8)'
      );
      assert.deepEqual(executedQuery.values, [
        ts,
        'INFO',
        20000,
        'req-999',
        42,
        'User logged in',
        'auth-api',
        null,
      ]);

      await pgAppender.shutdown();
    });

    await t.test('should support extending DEFAULT_COLUMNS', async () => {
      let executedQuery = null;

      const pgAppender = appender.configure({
        tableName: 'logs',
        columns: {
          ...appender.DEFAULT_COLUMNS,
          request_id: 'context.requestId',
        },
      });

      pgAppender.pool.query = async (query) => {
        executedQuery = query;
        return { rows: [] };
      };

      const ts = new Date('2026-06-01T10:00:00Z');
      pgAppender({
        startTime: ts,
        categoryName: 'api',
        data: ['ok'],
        level: { levelStr: 'INFO' },
        context: { requestId: 'req-1' },
      });

      await new Promise(resolve => setTimeout(resolve, 20));

      assert.ok(executedQuery);
      assert.equal(
        executedQuery.text,
        'INSERT INTO "public"."logs" ("startTime", "categoryName", "data", "level", "context", "request_id") VALUES($1, $2, $3, $4, $5, $6)'
      );
      assert.deepEqual(executedQuery.values, [
        ts,
        'api',
        '["ok"]',
        'INFO',
        '{"requestId":"req-1"}',
        'req-1',
      ]);

      await pgAppender.shutdown();
    });

    await t.test('should abort insert and route error to onError when custom extractor throws', async () => {
      let capturedError = null;
      let capturedEvent = null;
      let queryCalled = false;

      const pgAppender = appender.configure({
        columns: {
          created_at: 'startTime',
          broken: () => {
            throw new Error('extractor failed');
          },
        },
        onError: (err, event) => {
          capturedError = err;
          capturedEvent = event;
        },
      });

      pgAppender.pool.query = async () => {
        queryCalled = true;
        return { rows: [] };
      };

      const testEvent = {
        startTime: new Date(),
        categoryName: 'test',
        data: ['msg'],
        level: { levelStr: 'ERROR' },
      };

      pgAppender(testEvent);

      await new Promise(resolve => setTimeout(resolve, 20));

      assert.equal(queryCalled, false);
      assert.ok(capturedError instanceof Error);
      assert.equal(capturedError.message, 'extractor failed');
      assert.strictEqual(capturedEvent, testEvent);

      await pgAppender.shutdown();
    });

    await t.test('should map real log4js LoggingEvent fields end-to-end', async () => {
      let executedQuery = null;

      log4js.configure({
        appenders: {
          db: {
            type: {
              configure: (cfg) => {
                const instance = appender.configure(cfg);
                instance.pool.query = async (query) => {
                  executedQuery = query;
                  return { rows: [] };
                };
                return instance;
              },
            },
            tableName: 'events',
            columns: {
              created_at: 'startTime',
              severity: 'level',
              level_num: 'level.level',
              category: 'categoryName',
              request_id: 'context.requestId',
              message: 'data.0',
              user_id: 'data.1.userId',
              pid: 'pid',
            },
          },
        },
        categories: {
          default: { appenders: ['db'], level: 'info' },
        },
      });

      try {
        const logger = log4js.getLogger('orders');
        logger.addContext('requestId', 'req-log4js-1');
        logger.info('Order placed', { userId: 123 });

        await new Promise(resolve => setTimeout(resolve, 20));

        assert.ok(executedQuery);
        assert.equal(
          executedQuery.text,
          'INSERT INTO "public"."events" ("created_at", "severity", "level_num", "category", "request_id", "message", "user_id", "pid") VALUES($1, $2, $3, $4, $5, $6, $7, $8)'
        );
        assert.ok(executedQuery.values[0] instanceof Date);
        assert.equal(executedQuery.values[1], 'INFO');
        assert.equal(executedQuery.values[2], 20000);
        assert.equal(executedQuery.values[3], 'orders');
        assert.equal(executedQuery.values[4], 'req-log4js-1');
        assert.equal(executedQuery.values[5], 'Order placed');
        assert.equal(executedQuery.values[6], 123);
        assert.equal(executedQuery.values[7], process.pid);
      } finally {
        await new Promise((resolve) => log4js.shutdown(() => resolve()));
      }
    });

    await t.test('should enforce maxPendingWrites backpressure and recover after queries settle', async () => {
      const resolvers = [];
      const errors = [];
      let queryCalls = 0;

      const pgAppender = appender.configure({
        maxPendingWrites: 2,
        onError: (err, event) => {
          errors.push({ err, event });
        },
      });

      pgAppender.pool.query = () => {
        queryCalls += 1;
        return new Promise((resolve) => {
          resolvers.push(resolve);
        });
      };

      const makeEvent = (n) => ({
        startTime: new Date(),
        categoryName: 'bp',
        data: [n],
        level: { levelStr: 'INFO' },
      });

      pgAppender(makeEvent(1));
      pgAppender(makeEvent(2));
      const droppedEvent = makeEvent(3);
      pgAppender(droppedEvent);

      assert.equal(queryCalls, 2);
      assert.equal(errors.length, 1);
      assert.match(errors[0].err.message, /Pending log write queue limit \(2\) reached/);
      assert.strictEqual(errors[0].event, droppedEvent);

      resolvers.shift()({ rows: [] });
      await new Promise((resolve) => setTimeout(resolve, 10));

      pgAppender(makeEvent(4));
      assert.equal(queryCalls, 3);

      while (resolvers.length > 0) {
        resolvers.shift()({ rows: [] });
      }
      await pgAppender.shutdown();
    });

    await t.test('should isolate throwing onError callbacks without unhandled rejections', async () => {
      const origConsoleError = console.error;
      const fallbackLogs = [];
      console.error = (...args) => fallbackLogs.push(args);

      const pgAppender = appender.configure({
        columns: {
          broken: (e) => {
            if (e.categoryName === 'sync-fail') {
              throw new Error('sync boom');
            }
            return e.categoryName;
          },
        },
        onError: () => {
          throw new Error('onError itself crashed');
        },
      });

      pgAppender.pool.query = async () => {
        throw new Error('async query boom');
      };

      try {
        assert.doesNotThrow(() => {
          pgAppender({ categoryName: 'sync-fail' });
          pgAppender({ categoryName: 'async-fail' });
          pgAppender.pool.emit('error', new Error('idle pool boom'));
        });

        await new Promise((resolve) => setTimeout(resolve, 20));
        assert.equal(fallbackLogs.length, 3);
      } finally {
        console.error = origConsoleError;
        await pgAppender.shutdown();
      }
    });

    await t.test('should drain pending writes before pool.end, ignore post-shutdown logs, and make shutdown idempotent', async () => {
      const events = [];
      let resolveWrite;
      let endCalls = 0;

      const pgAppender = appender.configure({});
      pgAppender.pool.query = () => new Promise((resolve) => {
        events.push('query-started');
        resolveWrite = () => {
          events.push('query-finished');
          resolve({ rows: [] });
        };
      });
      const origEnd = pgAppender.pool.end.bind(pgAppender.pool);
      pgAppender.pool.end = async () => {
        endCalls += 1;
        events.push('pool-end');
        return origEnd();
      };

      pgAppender({
        startTime: new Date(),
        categoryName: 'drain',
        data: ['before-shutdown'],
        level: { levelStr: 'INFO' },
      });

      const p1 = pgAppender.shutdown();
      const p2 = pgAppender.shutdown();
      assert.strictEqual(p1, p2);

      // Post-shutdown log should be ignored and not start a new query
      pgAppender({
        startTime: new Date(),
        categoryName: 'drain',
        data: ['after-shutdown'],
        level: { levelStr: 'INFO' },
      });

      assert.deepEqual(events, ['query-started']);
      resolveWrite();
      await p1;

      assert.deepEqual(events, ['query-started', 'query-finished', 'pool-end']);
      assert.equal(endCalls, 1);
    });
  });

  await t.test('database backward compatibility module', async () => {
    const legacyConn1 = db.connect({ host: 'localhost' });
    const legacyConn2 = db.connect({ host: 'localhost' });
    assert.strictEqual(legacyConn1, legacyConn2);
    db.disconnect();
  });
});
