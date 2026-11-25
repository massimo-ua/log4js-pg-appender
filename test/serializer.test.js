const test = require('node:test');
const assert = require('node:assert/strict');
const safeStringify = require('../lib/serializer');

test('Serializer', async (t) => {
  await t.test('should serialize primitive values and plain objects', () => {
    assert.equal(safeStringify('hello'), '"hello"');
    assert.equal(safeStringify(123), '123');
    assert.equal(safeStringify({ a: 1 }), '{"a":1}');
    assert.equal(safeStringify([1, 2, 'three']), '[1,2,"three"]');
    assert.equal(safeStringify(null), 'null');
    assert.equal(safeStringify(undefined), undefined);
  });

  await t.test('should safely handle circular references', () => {
    const circularObj = { name: 'circular' };
    circularObj.self = circularObj;

    const result = safeStringify(circularObj);
    assert.equal(result, '{"name":"circular","self":"[Circular]"}');
  });

  await t.test('should serialize shared non-circular references accurately without false Circular', () => {
    const user = { id: 1, name: 'alice' };
    assert.equal(
      safeStringify({ actor: user, target: user }),
      '{"actor":{"id":1,"name":"alice"},"target":{"id":1,"name":"alice"}}'
    );
    assert.equal(
      safeStringify([user, user]),
      '[{"id":1,"name":"alice"},{"id":1,"name":"alice"}]'
    );
  });

  await t.test('should detect circular reference after an Error sibling', () => {
    const obj = { err: new Error('fail') };
    obj.self = obj;
    const parsed = JSON.parse(safeStringify(obj));
    assert.equal(parsed.err.name, 'Error');
    assert.equal(parsed.err.message, 'fail');
    assert.equal(parsed.self, '[Circular]');
  });

  await t.test('should safely serialize BigInt values', () => {
    assert.equal(safeStringify(42n), '"42"');
    const objWithBigInt = { id: 9007199254740991n };
    const result = safeStringify(objWithBigInt);
    assert.equal(result, '{"id":"9007199254740991"}');
  });

  await t.test('should serialize Error objects with details', () => {
    const err = new Error('Test error');
    const result = JSON.parse(safeStringify(err));
    assert.equal(result.name, 'Error');
    assert.equal(result.message, 'Test error');
    assert.ok(result.stack);

    const nested = JSON.parse(safeStringify(['request failed', { err }]));
    assert.equal(nested[0], 'request failed');
    assert.equal(nested[1].err.name, 'Error');
    assert.equal(nested[1].err.message, 'Test error');
    assert.ok(nested[1].err.stack);
  });

  await t.test('should guard against deep nesting DoS without stack overflow', () => {
    const root = {};
    let cur = root;
    for (let i = 0; i < 2000; i += 1) {
      cur.next = {};
      cur = cur.next;
    }
    const result = safeStringify(root);
    assert.ok(result.includes('"[MaxDepth]"'));
  });

  await t.test('should guard against Billion Laughs diamond DAG DoS', () => {
    let node = { leaf: 'x' };
    for (let i = 0; i < 30; i += 1) {
      node = { left: node, right: node };
    }
    const start = Date.now();
    const result = safeStringify(node);
    const elapsed = Date.now() - start;
    assert.ok(result.includes('"[Truncated]"'));
    assert.ok(elapsed < 1000, `Expected fast truncation, took ${elapsed}ms`);
  });

  await t.test('should guard against infinite toJSON expansion DoS', () => {
    const malicious = {
      toJSON() {
        return { nested: malicious };
      },
    };
    const result = safeStringify(malicious);
    assert.ok(result.includes('"[MaxDepth]"'));
  });

  await t.test('should respect non-enumerable toJSON on plain objects', () => {
    const obj = { a: 1 };
    Object.defineProperty(obj, 'toJSON', {
      enumerable: false,
      value() {
        return { custom: 99n };
      },
    });
    assert.equal(safeStringify(obj), '{"custom":"99"}');
  });

  await t.test('should fallback gracefully if an exception or non-Error is thrown', () => {
    const badObj = {
      toJSON() {
        throw new Error('Boom');
      },
    };
    const result = JSON.parse(safeStringify(badObj));
    assert.equal(result.error, 'Failed to serialize log data');
    assert.equal(result.message, 'Boom');

    const throwsNull = {
      toJSON() {
        throw null;
      },
    };
    const nullResult = JSON.parse(safeStringify(throwsNull));
    assert.equal(nullResult.error, 'Failed to serialize log data');
    assert.equal(nullResult.message, 'null');

    const throwsString = {
      toJSON() {
        throw 'string error';
      },
    };
    const strResult = JSON.parse(safeStringify(throwsString));
    assert.equal(strResult.error, 'Failed to serialize log data');
    assert.equal(strResult.message, 'string error');
  });
});
