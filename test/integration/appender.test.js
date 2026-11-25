const test = require('node:test');
const assert = require('node:assert/strict');
const log4js = require('log4js');
const { Client } = require('pg');
const { escapeIdentifier, setupTestDatabase, teardownTestDatabase } = require('./setup');
const testConfig = require('./config');
const appender = require('../../lib/appender');
const db = require('../../lib/db');

function createConnectionString() {
  const user = encodeURIComponent(testConfig.user);
  const password = encodeURIComponent(testConfig.password);
  const database = encodeURIComponent(testConfig.database);
  return `postgresql://${user}:${password}@${testConfig.host}:${testConfig.port}/${database}`;
}

async function withClient(fn) {
  const client = new Client(testConfig);
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function truncateDefaultTable() {
  await withClient(async (client) => {
    await client.query(`TRUNCATE TABLE ${escapeIdentifier(testConfig.tableName)}`);
  });
}

test('PostgreSQL Appender Integration', async (t) => {
  await setupTestDatabase();

  t.after(async () => {
    await db.disconnect();
    await teardownTestDatabase();
  });

  await t.test('default 5-column logging', async (t) => {
    t.beforeEach(async () => {
      await truncateDefaultTable();
    });

    await t.test('should write log entry and drain cleanly on shutdown', async () => {
      const pgAppender = appender.configure({
        ...testConfig,
        schema: null,
      });

      const ts = new Date('2026-06-01T12:00:00.000Z');
      pgAppender({
        startTime: ts,
        categoryName: 'test-category',
        data: { message: 'test message' },
        level: { levelStr: 'INFO' },
        context: { user: 'testuser' },
      });

      await pgAppender.shutdown();

      const rows = await withClient(async (client) => {
        const res = await client.query(
          `SELECT * FROM ${escapeIdentifier(testConfig.tableName)} WHERE "categoryName" = $1`,
          ['test-category']
        );
        return res.rows;
      });

      assert.equal(rows.length, 1);
      assert.equal(new Date(rows[0].startTime).toISOString(), ts.toISOString());
      assert.equal(rows[0].level, 'INFO');
      assert.deepEqual(rows[0].data, { message: 'test message' });
      assert.deepEqual(rows[0].context, { user: 'testuser' });
    });

    await t.test('should handle null context', async () => {
      const pgAppender = appender.configure({
        ...testConfig,
        schema: null,
      });

      pgAppender({
        startTime: new Date(),
        categoryName: 'null-context',
        data: ['plain message'],
        level: { levelStr: 'WARN' },
        context: null,
      });

      await pgAppender.shutdown();

      const rows = await withClient(async (client) => {
        const res = await client.query(
          `SELECT * FROM ${escapeIdentifier(testConfig.tableName)} WHERE "categoryName" = $1`,
          ['null-context']
        );
        return res.rows;
      });

      assert.equal(rows.length, 1);
      assert.equal(rows[0].context, null);
      assert.deepEqual(rows[0].data, ['plain message']);
    });

    await t.test('should connect and write using connectionString', async () => {
      const pgAppender = appender.configure({
        connectionString: createConnectionString(),
        schema: null,
        tableName: testConfig.tableName,
      });

      pgAppender({
        startTime: new Date(),
        categoryName: 'conn-string',
        data: ['connected'],
        level: { levelStr: 'DEBUG' },
        context: { source: 'url' },
      });

      await pgAppender.shutdown();

      const rows = await withClient(async (client) => {
        const res = await client.query(
          `SELECT * FROM ${escapeIdentifier(testConfig.tableName)} WHERE "categoryName" = $1`,
          ['conn-string']
        );
        return res.rows;
      });

      assert.equal(rows.length, 1);
      assert.equal(rows[0].level, 'DEBUG');
      assert.deepEqual(rows[0].context, { source: 'url' });
    });

    await t.test('should safely persist circular refs, shared DAG refs, BigInt, and Error in JSONB', async () => {
      const pgAppender = appender.configure({
        ...testConfig,
        schema: null,
      });

      const shared = { id: 10, role: 'admin' };
      const circular = { label: 'root' };
      circular.self = circular;
      const err = new Error('something failed');

      pgAppender({
        startTime: new Date(),
        categoryName: 'jsonb-complex',
        data: [{ actor: shared, target: shared, big: 9007199254740993n, err }],
        level: { levelStr: 'ERROR' },
        context: circular,
      });

      await pgAppender.shutdown();

      const rows = await withClient(async (client) => {
        const res = await client.query(
          `SELECT * FROM ${escapeIdentifier(testConfig.tableName)} WHERE "categoryName" = $1`,
          ['jsonb-complex']
        );
        return res.rows;
      });

      assert.equal(rows.length, 1);
      const payload = rows[0].data[0];
      assert.deepEqual(payload.actor, { id: 10, role: 'admin' });
      assert.deepEqual(payload.target, { id: 10, role: 'admin' });
      assert.equal(payload.big, '9007199254740993');
      assert.equal(payload.err.name, 'Error');
      assert.equal(payload.err.message, 'something failed');
      assert.ok(payload.err.stack);
      assert.deepEqual(rows[0].context, { label: 'root', self: '[Circular]' });
    });
  });

  await t.test('custom schema support', async () => {
    const customSchema = 'audit_integration';
    const customTable = 'app_logs';

    await withClient(async (client) => {
      await client.query(`CREATE SCHEMA IF NOT EXISTS ${escapeIdentifier(customSchema)}`);
      await client.query(`
        CREATE TABLE IF NOT EXISTS ${escapeIdentifier(customSchema)}.${escapeIdentifier(customTable)} (
          "id" SERIAL PRIMARY KEY,
          "startTime" TIMESTAMP WITH TIME ZONE NOT NULL,
          "categoryName" VARCHAR(255) NOT NULL,
          "data" JSONB NOT NULL,
          "level" VARCHAR(20) NOT NULL,
          "context" JSONB
        )
      `);
    });

    const explicitAppender = appender.configure({
      ...testConfig,
      schema: customSchema,
      tableName: customTable,
    });
    const dottedAppender = appender.configure({
      ...testConfig,
      tableName: `${customSchema}.${customTable}`,
    });

    try {
      explicitAppender({
        startTime: new Date(),
        categoryName: 'explicit-schema',
        data: ['via schema option'],
        level: { levelStr: 'INFO' },
        context: null,
      });
      dottedAppender({
        startTime: new Date(),
        categoryName: 'dotted-schema',
        data: ['via dotted tableName'],
        level: { levelStr: 'INFO' },
        context: null,
      });

      await Promise.all([explicitAppender.shutdown(), dottedAppender.shutdown()]);

      const rows = await withClient(async (client) => {
        const res = await client.query(
          `SELECT "categoryName", "data" FROM ${escapeIdentifier(customSchema)}.${escapeIdentifier(customTable)} ORDER BY "id"`
        );
        return res.rows;
      });

      assert.equal(rows.length, 2);
      assert.deepEqual(rows.map((r) => r.categoryName).sort(), ['dotted-schema', 'explicit-schema']);
    } finally {
      await withClient(async (client) => {
        await client.query(`DROP SCHEMA IF EXISTS ${escapeIdentifier(customSchema)} CASCADE`);
      });
    }
  });

  await t.test('custom column mapping', async (t) => {
    await t.test('should write custom mapped columns including built-ins, dot-paths, and extractors', async () => {
      const customTable = 'custom_mapped_logs';
      await withClient(async (client) => {
        await client.query(`
          CREATE TABLE IF NOT EXISTS ${escapeIdentifier(customTable)} (
            "id" SERIAL PRIMARY KEY,
            "created_at" TIMESTAMP WITH TIME ZONE NOT NULL,
            "severity" VARCHAR(10) NOT NULL,
            "level_num" INTEGER NOT NULL,
            "request_id" VARCHAR(64),
            "user_id" INTEGER,
            "message" TEXT NOT NULL,
            "service" VARCHAR(32) NOT NULL
          )
        `);
      });

      const pgAppender = appender.configure({
        ...testConfig,
        schema: null,
        tableName: customTable,
        columns: {
          created_at: 'startTime',
          severity: 'level',
          level_num: 'level.level',
          request_id: 'context.requestId',
          user_id: 'data.1.userId',
          message: (event) => event.data[0],
          service: () => 'auth-api',
        },
      });

      try {
        pgAppender({
          startTime: new Date('2026-01-01T00:00:00Z'),
          categoryName: 'custom',
          data: ['User signed in', { userId: 7 }],
          level: { level: 20000, levelStr: 'INFO' },
          context: { requestId: 'req-abc' },
        });

        await pgAppender.shutdown();

        const rows = await withClient(async (client) => {
          const res = await client.query(`SELECT * FROM ${escapeIdentifier(customTable)}`);
          return res.rows;
        });

        assert.equal(rows.length, 1);
        assert.equal(rows[0].severity, 'INFO');
        assert.equal(rows[0].level_num, 20000);
        assert.equal(rows[0].request_id, 'req-abc');
        assert.equal(rows[0].user_id, 7);
        assert.equal(rows[0].message, 'User signed in');
        assert.equal(rows[0].service, 'auth-api');
      } finally {
        await withClient(async (client) => {
          await client.query(`DROP TABLE IF EXISTS ${escapeIdentifier(customTable)}`);
        });
      }
    });

    await t.test('should support extending DEFAULT_COLUMNS and avoid prepared statement collisions on same table', async () => {
      const extendedTable = 'extended_default_logs';
      await withClient(async (client) => {
        await client.query(`
          CREATE TABLE IF NOT EXISTS ${escapeIdentifier(extendedTable)} (
            "id" SERIAL PRIMARY KEY,
            "startTime" TIMESTAMP WITH TIME ZONE NOT NULL,
            "categoryName" VARCHAR(255) NOT NULL,
            "data" JSONB NOT NULL,
            "level" VARCHAR(20) NOT NULL,
            "context" JSONB,
            "request_id" VARCHAR(64),
            "tenant" VARCHAR(64)
          )
        `);
      });

      const appenderA = appender.configure({
        ...testConfig,
        schema: null,
        tableName: extendedTable,
        columns: {
          ...appender.DEFAULT_COLUMNS,
          request_id: 'context.requestId',
        },
      });
      const appenderB = appender.configure({
        ...testConfig,
        schema: null,
        tableName: extendedTable,
        columns: {
          ...appender.DEFAULT_COLUMNS,
          tenant: 'context.tenant',
        },
      });

      try {
        appenderA({
          startTime: new Date(),
          categoryName: 'ext-a',
          data: ['from A'],
          level: { levelStr: 'INFO' },
          context: { requestId: 'req-a' },
        });
        appenderB({
          startTime: new Date(),
          categoryName: 'ext-b',
          data: ['from B'],
          level: { levelStr: 'WARN' },
          context: { tenant: 'acme' },
        });

        await Promise.all([appenderA.shutdown(), appenderB.shutdown()]);

        const rows = await withClient(async (client) => {
          const res = await client.query(
            `SELECT "categoryName", "request_id", "tenant" FROM ${escapeIdentifier(extendedTable)} ORDER BY "categoryName"`
          );
          return res.rows;
        });

        assert.equal(rows.length, 2);
        assert.deepEqual(rows[0], { categoryName: 'ext-a', request_id: 'req-a', tenant: null });
        assert.deepEqual(rows[1], { categoryName: 'ext-b', request_id: null, tenant: 'acme' });
      } finally {
        await withClient(async (client) => {
          await client.query(`DROP TABLE IF EXISTS ${escapeIdentifier(extendedTable)}`);
        });
      }
    });
  });

  await t.test('end-to-end log4js integration with graceful shutdown', async () => {
    const e2eTable = 'log4js_e2e_logs';
    await withClient(async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS ${escapeIdentifier(e2eTable)} (
          "id" SERIAL PRIMARY KEY,
          "created_at" TIMESTAMP WITH TIME ZONE NOT NULL,
          "severity" VARCHAR(20) NOT NULL,
          "category" VARCHAR(100) NOT NULL,
          "request_id" VARCHAR(64),
          "message" TEXT NOT NULL,
          "pid" INTEGER NOT NULL
        )
      `);
    });

    try {
      log4js.configure({
        appenders: {
          pg: {
            type: appender,
            ...testConfig,
            schema: null,
            tableName: e2eTable,
            columns: {
              created_at: 'startTime',
              severity: 'level',
              category: 'categoryName',
              request_id: 'context.requestId',
              message: 'data.0',
              pid: 'pid',
            },
          },
        },
        categories: {
          default: { appenders: ['pg'], level: 'info' },
        },
      });

      const logger = log4js.getLogger('checkout');
      logger.addContext('requestId', 'req-e2e-42');
      logger.info('Order confirmed');

      await new Promise((resolve, reject) => {
        log4js.shutdown((err) => (err ? reject(err) : resolve()));
      });

      const rows = await withClient(async (client) => {
        const res = await client.query(`SELECT * FROM ${escapeIdentifier(e2eTable)}`);
        return res.rows;
      });

      assert.equal(rows.length, 1);
      assert.equal(rows[0].severity, 'INFO');
      assert.equal(rows[0].category, 'checkout');
      assert.equal(rows[0].request_id, 'req-e2e-42');
      assert.equal(rows[0].message, 'Order confirmed');
      assert.equal(rows[0].pid, process.pid);
    } finally {
      await withClient(async (client) => {
        await client.query(`DROP TABLE IF EXISTS ${escapeIdentifier(e2eTable)}`);
      });
    }
  });

  await t.test('legacy database connection module', async (t) => {
    t.afterEach(async () => {
      await db.disconnect();
    });

    await t.test('should reuse existing connection and run queries', async () => {
      const firstConnection = db.connect(testConfig);
      const secondConnection = db.connect(testConfig);

      assert.strictEqual(firstConnection, secondConnection);
      const res = await firstConnection.query('SELECT 1 AS ok');
      assert.equal(res.rows[0].ok, 1);
    });

    await t.test('should reject queries after disconnect', async () => {
      const connection = db.connect(testConfig);
      await db.disconnect();

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
