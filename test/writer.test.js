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
});
