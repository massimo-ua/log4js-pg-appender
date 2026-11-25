const test = require('node:test');
const assert = require('node:assert/strict');
const writer = require('../lib/writer');

test('Writer', async (t) => {
  await t.test('should generate correct query with table name', async () => {
    let capturedQuery;
    const mockClient = {
      query: async (query) => {
        capturedQuery = query;
      },
    };

    const writeLog = writer(mockClient, 'test_table');
    await writeLog(
      '2024-01-01',
      'test',
      '{"message":"test"}',
      'INFO',
      null
    );

    assert.equal(capturedQuery.name, 'log4js-pg-test_table');
    assert.equal(
      capturedQuery.text,
      'INSERT INTO "test_table" ("startTime", "categoryName", "data", "level", "context") VALUES($1, $2, $3, $4, $5)'
    );
    assert.deepEqual(capturedQuery.values, ['2024-01-01', 'test', '{"message":"test"}', 'INFO', null]);
  });

  await t.test('should use default table name when omitted', async () => {
    let capturedQuery;
    const mockClient = {
      query: async (query) => {
        capturedQuery = query;
      },
    };

    const writeLog = writer(mockClient);
    await writeLog(
      '2024-01-01',
      'test',
      '{"message":"test"}',
      'INFO',
      null
    );

    assert.equal(capturedQuery.name, 'log4js-pg-Logs');
    assert.equal(
      capturedQuery.text,
      'INSERT INTO "Logs" ("startTime", "categoryName", "data", "level", "context") VALUES($1, $2, $3, $4, $5)'
    );
  });

  await t.test('should format schema and tableName options correctly', async () => {
    let capturedQuery;
    const mockClient = {
      query: async (query) => {
        capturedQuery = query;
      },
    };

    const writeLog = writer(mockClient, { schema: 'audit', tableName: 'logs' });
    await writeLog('2024-01-01', 'test', '{}', 'INFO', null);

    assert.equal(capturedQuery.name, 'log4js-pg-audit_logs');
    assert.equal(
      capturedQuery.text,
      'INSERT INTO "audit"."logs" ("startTime", "categoryName", "data", "level", "context") VALUES($1, $2, $3, $4, $5)'
    );
  });

  await t.test('should automatically split schema.table string', async () => {
    let capturedQuery;
    const mockClient = {
      query: async (query) => {
        capturedQuery = query;
      },
    };

    const writeLog = writer(mockClient, 'custom_schema.events');
    await writeLog('2024-01-01', 'test', '{}', 'INFO', null);

    assert.equal(capturedQuery.name, 'log4js-pg-custom_schema_events');
    assert.equal(
      capturedQuery.text,
      'INSERT INTO "custom_schema"."events" ("startTime", "categoryName", "data", "level", "context") VALUES($1, $2, $3, $4, $5)'
    );
  });

  await t.test('should safely escape double quotes in identifiers', async () => {
    let capturedQuery;
    const mockClient = {
      query: async (query) => {
        capturedQuery = query;
      },
    };

    const writeLog = writer(mockClient, { schema: 'my"schema', tableName: 'log"entries' });
    await writeLog('2024-01-01', 'test', '{}', 'INFO', null);

    assert.equal(
      capturedQuery.text,
      'INSERT INTO "my""schema"."log""entries" ("startTime", "categoryName", "data", "level", "context") VALUES($1, $2, $3, $4, $5)'
    );
  });

  await t.test('should generate query with custom columns and matching placeholders', async () => {
    let capturedQuery;
    const mockClient = {
      query: async (query) => {
        capturedQuery = query;
      },
    };

    const writeLog = writer(mockClient, {
      schema: 'public',
      tableName: 'logs',
      columns: ['created_at', 'severity', 'request_id'],
    });
    await writeLog('2026-01-01', 'INFO', 'req-123');

    assert.equal(
      capturedQuery.text,
      'INSERT INTO "public"."logs" ("created_at", "severity", "request_id") VALUES($1, $2, $3)'
    );
    assert.deepEqual(capturedQuery.values, ['2026-01-01', 'INFO', 'req-123']);
    assert.match(capturedQuery.name, /^log4js-pg-public_logs_[a-f0-9]{8}$/);
  });

  await t.test('should safely escape double quotes in custom column names', async () => {
    let capturedQuery;
    const mockClient = {
      query: async (query) => {
        capturedQuery = query;
      },
    };

    const writeLog = writer(mockClient, {
      tableName: 'logs',
      columns: ['col"one', 'col two'],
    });
    await writeLog('a', 'b');

    assert.equal(
      capturedQuery.text,
      'INSERT INTO "logs" ("col""one", "col two") VALUES($1, $2)'
    );
  });

  await t.test('should produce distinct prepared statement names <= 63 chars for different column sets', async () => {
    const captured = [];
    const mockClient = {
      query: async (query) => {
        captured.push(query);
      },
    };

    const longTable = 'very_long_schema_and_table_name_that_exceeds_sixty_three_characters_easily';
    const writeA = writer(mockClient, { schema: 'audit', tableName: longTable, columns: ['a', 'b'] });
    const writeB = writer(mockClient, { schema: 'audit', tableName: longTable, columns: ['a', 'c'] });

    await writeA(1, 2);
    await writeB(1, 3);

    assert.notEqual(captured[0].name, captured[1].name);
    assert.ok(captured[0].name.length <= 63);
    assert.ok(captured[1].name.length <= 63);
  });

  await t.test('should keep legacy query name when explicit columns match default columns', async () => {
    let capturedQuery;
    const mockClient = {
      query: async (query) => {
        capturedQuery = query;
      },
    };

    const writeLog = writer(mockClient, {
      schema: 'public',
      tableName: 'logs',
      columns: ['startTime', 'categoryName', 'data', 'level', 'context'],
    });
    await writeLog('2026-01-01', 'cat', '[]', 'INFO', null);

    assert.equal(capturedQuery.name, 'log4js-pg-public_logs');
  });

  await t.test('should reject null bytes and blank identifiers', () => {
    const mockClient = { query: async () => {} };

    assert.throws(
      () => writer(mockClient, { tableName: 'bad\0table' }),
      /SQL identifier must not contain null bytes/
    );
    assert.throws(
      () => writer(mockClient, { schema: 'bad\0schema', tableName: 'logs' }),
      /SQL identifier must not contain null bytes/
    );
    assert.throws(
      () => writer(mockClient, { tableName: 'logs', columns: ['bad\0col'] }),
      /SQL identifier must not contain null bytes/
    );
    assert.throws(
      () => writer(mockClient, '   '),
      /SQL identifier must be a non-empty string/
    );
    assert.throws(
      () => writer(mockClient, { tableName: 'logs', columns: [123] }),
      /SQL identifier must be a string/
    );
  });

  await t.test('should avoid prepared statement collisions for sanitized names and long default tables', async () => {
    const captured = [];
    const mockClient = {
      query: async (query) => {
        captured.push(query);
      },
    };

    const writeHyphen = writer(mockClient, { schema: 'public', tableName: 'user-logs' });
    const writeUnderscore = writer(mockClient, { schema: 'public', tableName: 'user_logs' });
    await writeHyphen('2026-01-01', 'c', '[]', 'INFO', null);
    await writeUnderscore('2026-01-01', 'c', '[]', 'INFO', null);
    assert.notEqual(captured[0].name, captured[1].name);

    const longPrefix = 'a'.repeat(60);
    const writeLong1 = writer(mockClient, { schema: 'public', tableName: `${longPrefix}_1` });
    const writeLong2 = writer(mockClient, { schema: 'public', tableName: `${longPrefix}_2` });
    await writeLong1('2026-01-01', 'c', '[]', 'INFO', null);
    await writeLong2('2026-01-01', 'c', '[]', 'INFO', null);
    assert.ok(captured[2].name.length <= 63);
    assert.ok(captured[3].name.length <= 63);
    assert.notEqual(captured[2].name, captured[3].name);
  });

  await t.test('should support writeValues directly without rest/spread copying', async () => {
    let capturedQuery;
    const mockClient = {
      query: async (query) => {
        capturedQuery = query;
      },
    };

    const writeLog = writer(mockClient, { tableName: 'logs', columns: ['a', 'b'] });
    const values = ['x', 1];
    await writeLog.writeValues(values);
    assert.strictEqual(capturedQuery.values, values);
  });
});
