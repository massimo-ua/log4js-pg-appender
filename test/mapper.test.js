const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_COLUMNS,
  validateColumns,
  compileMapper,
  serializeValue,
} = require('../lib/mapper');

test('Mapper', async (t) => {
  await t.test('DEFAULT_COLUMNS', () => {
    assert.ok(Object.isFrozen(DEFAULT_COLUMNS));
    assert.deepEqual(DEFAULT_COLUMNS, {
      startTime: 'startTime',
      categoryName: 'categoryName',
      data: 'data',
      level: 'level',
      context: 'context',
    });
  });

  await t.test('validateColumns', async (t) => {
    await t.test('should accept undefined and valid mappings', () => {
      assert.doesNotThrow(() => validateColumns(undefined));
      assert.doesNotThrow(() => validateColumns({
        created_at: 'startTime',
        request_id: 'context.requestId',
        user_id: 'data.0.userId',
        message: (event) => event.data[0],
      }));
    });

    await t.test('should reject non-plain-object values', () => {
      for (const invalid of [null, [], 'startTime', 123, new Date()]) {
        assert.throws(
          () => validateColumns(invalid),
          /columns must be a plain object/
        );
      }
    });

    await t.test('should reject empty columns object', () => {
      assert.throws(
        () => validateColumns({}),
        /columns must define at least one column/
      );
    });

    await t.test('should reject blank column names and null bytes', () => {
      assert.throws(
        () => validateColumns({ '': 'startTime' }),
        /column name must be a non-empty string/
      );
      assert.throws(
        () => validateColumns({ '   ': 'startTime' }),
        /column name must be a non-empty string/
      );
      assert.throws(
        () => validateColumns({ 'col\0name': 'startTime' }),
        /column name must not contain null bytes/
      );
    });

    await t.test('should reject non-string/non-function sources', () => {
      for (const invalidSource of [null, undefined, 42, {}, [], '', '   ']) {
        assert.throws(
          () => validateColumns({ col: invalidSource }),
          /column "col" mapping must be a non-empty string or function/
        );
      }
    });

    await t.test('should reject malformed dot-paths', () => {
      for (const badPath of ['.a', 'a.', 'a..b', 'a. .b']) {
        assert.throws(
          () => validateColumns({ col: badPath }),
          /has invalid path/
        );
      }
    });

    await t.test('should reject forbidden prototype segments', () => {
      for (const dangerous of ['__proto__', 'context.__proto__', 'constructor', 'data.0.prototype']) {
        assert.throws(
          () => validateColumns({ col: dangerous }),
          /contains forbidden segment/
        );
      }
    });
  });

  await t.test('compileMapper default and built-in extraction', async (t) => {
    await t.test('should default to DEFAULT_COLUMNS when columns is omitted', () => {
      const { columnNames, extractValues } = compileMapper();
      assert.deepEqual(columnNames, ['startTime', 'categoryName', 'data', 'level', 'context']);

      const ts = new Date('2026-01-01T00:00:00Z');
      const values = extractValues({
        startTime: ts,
        categoryName: 'app',
        data: ['hello'],
        level: { level: 20000, levelStr: 'INFO' },
        context: { requestId: 'req-1' },
      });

      assert.deepEqual(values, [ts, 'app', '["hello"]', 'INFO', '{"requestId":"req-1"}']);
    });

    await t.test('should preserve built-in normalization when mapped to custom column names', () => {
      const { columnNames, extractValues } = compileMapper({
        ts: 'startTime',
        cat: 'categoryName',
        severity: 'level',
        payload: 'data',
        meta: 'context',
      });

      assert.deepEqual(columnNames, ['ts', 'cat', 'severity', 'payload', 'meta']);

      const values = extractValues({
        data: 'plain-string',
        level: { level: 40000, levelStr: 'ERROR' },
      });

      assert.ok(values[0] instanceof Date);
      assert.equal(values[1], '');
      assert.equal(values[2], 'ERROR');
      assert.equal(values[3], '"plain-string"');
      assert.equal(values[4], null);
    });

    await t.test('should allow dot-path access into raw level object', () => {
      const { extractValues } = compileMapper({
        level_name: 'level',
        level_num: 'level.level',
      });

      const values = extractValues({
        level: { level: 30000, levelStr: 'WARN', colour: 'yellow' },
      });

      assert.deepEqual(values, ['WARN', 30000]);
    });
  });

  await t.test('nested dot-path extraction', async (t) => {
    await t.test('should extract nested context, array data, pid, and Error fields', () => {
      const { extractValues } = compileMapper({
        request_id: 'context.requestId',
        nested_flag: 'context.flags.enabled',
        zero_count: 'context.count',
        empty_tag: 'context.tag',
        first_msg: 'data.0',
        user_id: 'data.1.userId',
        pid: 'pid',
        err_name: 'error.name',
        err_msg: 'error.message',
        missing: 'context.does.not.exist',
        through_primitive: 'data.0.nested',
      });

      const err = new TypeError('bad input');
      const values = extractValues({
        pid: 4321,
        data: ['user action', { userId: 99 }],
        context: {
          requestId: 'req-42',
          flags: { enabled: false },
          count: 0,
          tag: '',
        },
        error: err,
      });

      assert.deepEqual(values, [
        'req-42',
        false,
        0,
        '',
        'user action',
        99,
        4321,
        'TypeError',
        'bad input',
        null,
        null,
      ]);
    });

    await t.test('should ignore inherited Object.prototype properties but allow own properties', () => {
      const { extractValues } = compileMapper({
        inherited: 'toString',
        nested_inherited: 'context.valueOf',
        own_override: 'context.toString',
      });

      const values = extractValues({
        context: { toString: 'custom-value' },
      });

      assert.deepEqual(values, [null, null, 'custom-value']);
    });
  });

  await t.test('custom extractor functions and smart serialization', () => {
    const now = new Date('2026-05-01T12:00:00Z');
    const buf = Buffer.from('abc');
    const circular = { a: 1 };
    circular.self = circular;
    const err = new Error('boom');

    const { extractValues } = compileMapper({
      service: () => 'billing',
      joined: (e) => e.data.join(' '),
      ts: () => now,
      raw_buf: () => buf,
      big: () => 9007199254740993n,
      flag: () => true,
      num: () => 0,
      obj: () => circular,
      arr: () => [1, 2],
      err: () => err,
      undef: () => undefined,
      nil: () => null,
    });

    const values = extractValues({ data: ['hello', 'world'] });

    assert.equal(values[0], 'billing');
    assert.equal(values[1], 'hello world');
    assert.strictEqual(values[2], now);
    assert.strictEqual(values[3], buf);
    assert.equal(values[4], '9007199254740993');
    assert.equal(values[5], true);
    assert.equal(values[6], 0);
    assert.equal(values[7], '{"a":1,"self":"[Circular]"}');
    assert.equal(values[8], '[1,2]');
    const parsedErr = JSON.parse(values[9]);
    assert.equal(parsedErr.name, 'Error');
    assert.equal(parsedErr.message, 'boom');
    assert.ok(parsedErr.stack);
    assert.equal(values[10], null);
    assert.equal(values[11], null);
  });

  await t.test('serializeValue handles functions and symbols safely', () => {
    assert.equal(serializeValue(() => {}), null);
    assert.equal(serializeValue(Symbol('s')), 'Symbol(s)');
  });

  await t.test('compileMapper snapshots columns against later mutation', () => {
    const cols = { created_at: 'startTime', severity: 'level' };
    const { columnNames, extractValues } = compileMapper(cols);

    cols.extra = 'categoryName';
    cols.severity = 'categoryName';

    assert.deepEqual(columnNames, ['created_at', 'severity']);
    const ts = new Date('2026-01-01T00:00:00Z');
    assert.deepEqual(
      extractValues({ startTime: ts, level: { levelStr: 'INFO' }, categoryName: 'cat' }),
      [ts, 'INFO']
    );
  });
});
