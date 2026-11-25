const test = require('node:test');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { Client } = require('pg');
const { escapeIdentifier, setupTestDatabase, teardownTestDatabase } = require('../integration/setup');
const testConfig = require('../integration/config');
const appender = require('../../lib/appender');

const BURST_EVENTS = Number(process.env.PERF_EVENTS) || 2000;

async function withClient(fn) {
  const client = new Client(testConfig);
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

function formatMb(bytes) {
  return (bytes / (1024 * 1024)).toFixed(1);
}

test('PostgreSQL Live Performance Tests', async (t) => {
  await setupTestDatabase();

  t.after(async () => {
    await teardownTestDatabase();
  });

  await t.test(`default 5-column burst throughput (${BURST_EVENTS} events)`, async () => {
    await withClient(async (client) => {
      await client.query(`TRUNCATE TABLE ${escapeIdentifier(testConfig.tableName)}`);
    });

    let errorCount = 0;
    const pgAppender = appender.configure({
      ...testConfig,
      schema: null,
      max: 10,
      maxPendingWrites: BURST_EVENTS + 100,
      onError: () => {
        errorCount += 1;
      },
    });

    const start = performance.now();
    for (let i = 0; i < BURST_EVENTS; i += 1) {
      pgAppender({
        startTime: new Date(),
        categoryName: 'perf-default',
        data: ['Request processed', { seq: i, status: 200 }],
        level: { level: 20000, levelStr: 'INFO' },
        context: { requestId: `req-${i}`, tenant: 'acme' },
      });
    }
    await pgAppender.shutdown();
    const elapsedMs = performance.now() - start;
    const rowsPerSec = Math.round((BURST_EVENTS / elapsedMs) * 1000);

    const count = await withClient(async (client) => {
      const res = await client.query(`SELECT COUNT(*)::int AS count FROM ${escapeIdentifier(testConfig.tableName)}`);
      return res.rows[0].count;
    });

    console.log(
      `[perf:pg]   ${`default 5-column burst (${BURST_EVENTS} rows)`.padEnd(44)} ${elapsedMs.toFixed(1).padStart(7)} ms | ${rowsPerSec.toLocaleString().padStart(11)} rows/s`
    );

    assert.equal(errorCount, 0);
    assert.equal(count, BURST_EVENTS);
    assert.ok(rowsPerSec >= 300, `Expected >= 300 rows/s, got ${rowsPerSec}`);
  });

  await t.test(`custom mapped columns burst throughput (${BURST_EVENTS} events)`, async () => {
    const customTable = 'perf_custom_logs';
    await withClient(async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS ${escapeIdentifier(customTable)} (
          "id" SERIAL PRIMARY KEY,
          "created_at" TIMESTAMP WITH TIME ZONE NOT NULL,
          "severity" VARCHAR(10) NOT NULL,
          "request_id" VARCHAR(64) NOT NULL,
          "seq" INTEGER NOT NULL,
          "message" TEXT NOT NULL
        )
      `);
      await client.query(`TRUNCATE TABLE ${escapeIdentifier(customTable)}`);
    });

    let errorCount = 0;
    const pgAppender = appender.configure({
      ...testConfig,
      schema: null,
      tableName: customTable,
      max: 10,
      maxPendingWrites: BURST_EVENTS + 100,
      columns: {
        created_at: 'startTime',
        severity: 'level',
        request_id: 'context.requestId',
        seq: 'data.1.seq',
        message: (event) => event.data[0],
      },
      onError: () => {
        errorCount += 1;
      },
    });

    try {
      const start = performance.now();
      for (let i = 0; i < BURST_EVENTS; i += 1) {
        pgAppender({
          startTime: new Date(),
          categoryName: 'perf-custom',
          data: ['Order processed', { seq: i }],
          level: { level: 20000, levelStr: 'INFO' },
          context: { requestId: `req-${i}` },
        });
      }
      await pgAppender.shutdown();
      const elapsedMs = performance.now() - start;
      const rowsPerSec = Math.round((BURST_EVENTS / elapsedMs) * 1000);

      const count = await withClient(async (client) => {
        const res = await client.query(`SELECT COUNT(*)::int AS count FROM ${escapeIdentifier(customTable)}`);
        return res.rows[0].count;
      });

      console.log(
        `[perf:pg]   ${`custom mapped burst (${BURST_EVENTS} rows)`.padEnd(44)} ${elapsedMs.toFixed(1).padStart(7)} ms | ${rowsPerSec.toLocaleString().padStart(11)} rows/s`
      );

      assert.equal(errorCount, 0);
      assert.equal(count, BURST_EVENTS);
      assert.ok(rowsPerSec >= 300, `Expected >= 300 rows/s, got ${rowsPerSec}`);
    } finally {
      await withClient(async (client) => {
        await client.query(`DROP TABLE IF EXISTS ${escapeIdentifier(customTable)}`);
      });
    }
  });

  await t.test(`backpressure burst accounting under tight maxPendingWrites (${BURST_EVENTS} events)`, async () => {
    await withClient(async (client) => {
      await client.query(`TRUNCATE TABLE ${escapeIdentifier(testConfig.tableName)}`);
    });

    const queueLimit = Math.min(100, Math.max(10, Math.floor(BURST_EVENTS / 10)));
    let droppedCount = 0;
    const unexpectedErrors = [];

    const pgAppender = appender.configure({
      ...testConfig,
      schema: null,
      max: 4,
      maxPendingWrites: queueLimit,
      onError: (err) => {
        if (err && /Pending log write queue limit/.test(err.message)) {
          droppedCount += 1;
        } else {
          unexpectedErrors.push(err);
        }
      },
    });

    const heapBefore = process.memoryUsage().heapUsed;
    const start = performance.now();
    for (let i = 0; i < BURST_EVENTS; i += 1) {
      pgAppender({
        startTime: new Date(),
        categoryName: 'perf-backpressure',
        data: ['Burst event', { seq: i }],
        level: { levelStr: 'WARN' },
        context: { burst: true },
      });
    }
    await pgAppender.shutdown();
    const elapsedMs = performance.now() - start;
    const heapDeltaBytes = process.memoryUsage().heapUsed - heapBefore;

    const persistedCount = await withClient(async (client) => {
      const res = await client.query(`SELECT COUNT(*)::int AS count FROM ${escapeIdentifier(testConfig.tableName)}`);
      return res.rows[0].count;
    });

    console.log(
      `[perf:pg]   ${`backpressure burst (limit=${queueLimit})`.padEnd(44)} ${elapsedMs.toFixed(1).padStart(7)} ms | persisted=${persistedCount}, dropped=${droppedCount}, heapDelta=${formatMb(heapDeltaBytes)}MB`
    );

    assert.equal(unexpectedErrors.length, 0, `Unexpected DB errors: ${unexpectedErrors.map((e) => e.message).join('; ')}`);
    assert.ok(droppedCount > 0, 'Expected backpressure to drop excess events during synchronous burst');
    assert.equal(persistedCount + droppedCount, BURST_EVENTS);
    assert.ok(heapDeltaBytes < 100 * 1024 * 1024, `Heap grew too much: ${formatMb(heapDeltaBytes)}MB`);
  });

  await t.test('sustained multi-wave load and memory stability (5 x 500 events)', async () => {
    await withClient(async (client) => {
      await client.query(`TRUNCATE TABLE ${escapeIdentifier(testConfig.tableName)}`);
    });

    const waves = 5;
    const waveSize = 500;
    const totalEvents = waves * waveSize;
    const waveDurations = [];
    let errorCount = 0;

    const pgAppender = appender.configure({
      ...testConfig,
      schema: null,
      max: 10,
      onError: () => {
        errorCount += 1;
      },
    });

    const heapBefore = process.memoryUsage().heapUsed;
    const totalStart = performance.now();

    for (let w = 0; w < waves; w += 1) {
      const waveStart = performance.now();
      for (let i = 0; i < waveSize; i += 1) {
        pgAppender({
          startTime: new Date(),
          categoryName: 'perf-sustained',
          data: ['Wave event', { wave: w, seq: i }],
          level: { levelStr: 'INFO' },
          context: { wave: w },
        });
      }
      // Wait for wave to finish draining into PostgreSQL
      let persisted = 0;
      const expected = (w + 1) * waveSize;
      while (persisted < expected) {
        persisted = await withClient(async (client) => {
          const res = await client.query(`SELECT COUNT(*)::int AS count FROM ${escapeIdentifier(testConfig.tableName)}`);
          return res.rows[0].count;
        });
        if (persisted < expected) {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      }
      waveDurations.push(performance.now() - waveStart);
    }

    await pgAppender.shutdown();
    const totalMs = performance.now() - totalStart;
    const heapDeltaBytes = process.memoryUsage().heapUsed - heapBefore;
    const sorted = [...waveDurations].sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length * 0.5)];
    const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
    const rowsPerSec = Math.round((totalEvents / totalMs) * 1000);

    console.log(
      `[perf:pg]   ${`sustained waves (${waves}x${waveSize} rows)`.padEnd(44)} ${totalMs.toFixed(1).padStart(7)} ms | ${rowsPerSec.toLocaleString().padStart(11)} rows/s | wave p50=${p50.toFixed(1)}ms p95=${p95.toFixed(1)}ms heapDelta=${formatMb(heapDeltaBytes)}MB`
    );

    assert.equal(errorCount, 0);
    assert.ok(rowsPerSec >= 300, `Expected >= 300 rows/s, got ${rowsPerSec}`);
    assert.ok(heapDeltaBytes < 100 * 1024 * 1024, `Heap grew too much: ${formatMb(heapDeltaBytes)}MB`);
  });
});
