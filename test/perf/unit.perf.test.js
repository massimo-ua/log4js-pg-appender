const test = require('node:test');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const safeStringify = require('../../lib/serializer');
const { compileMapper } = require('../../lib/mapper');
const appender = require('../../lib/appender');

function measureSync(label, iterations, fn) {
  const warmup = Math.min(5000, Math.max(100, Math.floor(iterations / 10)));
  for (let i = 0; i < warmup; i += 1) {
    fn();
  }

  const start = performance.now();
  for (let i = 0; i < iterations; i += 1) {
    fn();
  }
  const elapsedMs = performance.now() - start;
  const opsPerSec = Math.round((iterations / elapsedMs) * 1000);
  const nsPerOp = Math.round((elapsedMs * 1e6) / iterations);

  console.log(
    `[perf:unit] ${label.padEnd(44)} ${elapsedMs.toFixed(1).padStart(7)} ms | ${opsPerSec.toLocaleString().padStart(11)} ops/s | ${String(nsPerOp).padStart(6)} ns/op`
  );

  return { elapsedMs, opsPerSec, nsPerOp };
}

test('Unit Performance Benchmarks', async (t) => {
  const simpleEvent = {
    startTime: new Date('2026-06-01T12:00:00.000Z'),
    categoryName: 'http',
    data: ['GET /api/users 200 12ms'],
    level: { level: 20000, levelStr: 'INFO' },
    context: { requestId: 'req-123', tenant: 'acme' },
    pid: 1234,
  };

  const nestedEvent = {
    startTime: new Date('2026-06-01T12:00:00.000Z'),
    categoryName: 'orders',
    data: [
      'Order created',
      {
        orderId: 999,
        items: [
          { sku: 'A', qty: 2 },
          { sku: 'B', qty: 1 },
        ],
        total: 49.99,
      },
    ],
    level: { level: 20000, levelStr: 'INFO' },
    context: { requestId: 'req-456', user: { id: 42, role: 'admin' } },
    pid: 1234,
  };

  await t.test('safeStringify simple array fast path', () => {
    const { opsPerSec } = measureSync('safeStringify simple array', 100000, () => {
      safeStringify(simpleEvent.data);
    });
    assert.ok(opsPerSec >= 500000, `Expected >= 500,000 ops/s, got ${opsPerSec}`);
  });

  await t.test('safeStringify flat context fast path', () => {
    const { opsPerSec } = measureSync('safeStringify flat context', 100000, () => {
      safeStringify(simpleEvent.context);
    });
    assert.ok(opsPerSec >= 300000, `Expected >= 300,000 ops/s, got ${opsPerSec}`);
  });

  await t.test('safeStringify nested payload fast path', () => {
    const { opsPerSec } = measureSync('safeStringify nested payload', 50000, () => {
      safeStringify(nestedEvent.data);
    });
    assert.ok(opsPerSec >= 100000, `Expected >= 100,000 ops/s, got ${opsPerSec}`);
  });

  await t.test('safeStringify adversarial deep-nesting and diamond DAG DoS bounds', () => {
    const deep = {};
    let cur = deep;
    for (let i = 0; i < 2000; i += 1) {
      cur.next = {};
      cur = cur.next;
    }

    let dag = { leaf: 'x' };
    for (let i = 0; i < 30; i += 1) {
      dag = { left: dag, right: dag };
    }

    const deepMetrics = measureSync('safeStringify deep chain (depth=2000)', 200, () => {
      const out = safeStringify(deep);
      assert.ok(out.includes('"[MaxDepth]"'));
    });
    assert.ok(deepMetrics.elapsedMs < 1000, `Deep nesting took too long: ${deepMetrics.elapsedMs}ms`);

    const dagMetrics = measureSync('safeStringify diamond DAG (2^30)', 20, () => {
      const out = safeStringify(dag);
      assert.ok(out.includes('"[Truncated]"'));
    });
    assert.ok(dagMetrics.elapsedMs < 2000, `Diamond DAG took too long: ${dagMetrics.elapsedMs}ms`);
  });

  await t.test('compileMapper default 5-column extraction', () => {
    const { extractValues } = compileMapper();
    const { opsPerSec } = measureSync('mapper default 5 columns (simple)', 100000, () => {
      extractValues(simpleEvent);
    });
    assert.ok(opsPerSec >= 200000, `Expected >= 200,000 ops/s, got ${opsPerSec}`);
  });

  await t.test('compileMapper custom 7-column extraction (dot-paths + function)', () => {
    const { extractValues } = compileMapper({
      created_at: 'startTime',
      severity: 'level',
      category: 'categoryName',
      request_id: 'context.requestId',
      user_id: 'context.user.id',
      message: (e) => e.data[0],
      pid: 'pid',
    });
    const { opsPerSec } = measureSync('mapper custom 7 columns (nested)', 100000, () => {
      extractValues(nestedEvent);
    });
    assert.ok(opsPerSec >= 500000, `Expected >= 500,000 ops/s, got ${opsPerSec}`);
  });

  await t.test('appender end-to-end hot path with mock pool and microtask drain', async () => {
    const pgAppender = appender.configure({
      tableName: 'logs',
      maxPendingWrites: 5000,
    });
    const resolved = Promise.resolve({ rows: [] });
    let queryCount = 0;
    pgAppender.pool.query = () => {
      queryCount += 1;
      return resolved;
    };

    const batches = 50;
    const batchSize = 1000;
    const totalEvents = batches * batchSize;

    // Warmup
    for (let i = 0; i < 1000; i += 1) {
      pgAppender(simpleEvent);
    }
    await new Promise((resolve) => setImmediate(resolve));
    queryCount = 0;

    const start = performance.now();
    for (let b = 0; b < batches; b += 1) {
      for (let i = 0; i < batchSize; i += 1) {
        pgAppender(simpleEvent);
      }
      await new Promise((resolve) => setImmediate(resolve));
    }
    await pgAppender.shutdown();
    const elapsedMs = performance.now() - start;
    const opsPerSec = Math.round((totalEvents / elapsedMs) * 1000);
    const nsPerOp = Math.round((elapsedMs * 1e6) / totalEvents);

    console.log(
      `[perf:unit] ${'appender hot path (batched mock pool)'.padEnd(44)} ${elapsedMs.toFixed(1).padStart(7)} ms | ${opsPerSec.toLocaleString().padStart(11)} ops/s | ${String(nsPerOp).padStart(6)} ns/op`
    );

    assert.equal(queryCount, totalEvents);
    assert.ok(opsPerSec >= 100000, `Expected >= 100,000 ops/s, got ${opsPerSec}`);
  });
});
