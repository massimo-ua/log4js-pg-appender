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

  await t.test('should safely serialize BigInt values', () => {
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
  });

  await t.test('should fallback gracefully if an exception is thrown', () => {
    const badObj = {
      toJSON() {
        throw new Error('Boom');
      },
    };
    const result = JSON.parse(safeStringify(badObj));
    assert.equal(result.error, 'Failed to serialize log data');
    assert.equal(result.message, 'Boom');
  });
});
