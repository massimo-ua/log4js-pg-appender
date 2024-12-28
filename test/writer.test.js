const test = require('node:test');
const assert = require('node:assert/strict');
const writer = require('../lib/writer');
  
test('Writer', async (t) => {
  await t.test('should generate correct query', async () => {
    const mockClient = {
      query: async ({ name, text, values }) => {
        assert.equal(name, 'log4js-pg-appender-add-record');
        assert.equal(
          text,
          'INSERT INTO "test_table" ("startTime", "categoryName", "data", "level", "context") VALUES($1, $2, $3, $4, $5)'
        );
        assert.deepEqual(values, ['2024-01-01', 'test', '{"message":"test"}', 'INFO', null]);
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
  });
  
  await t.test('should use default table name', async () => {
    const mockClient = {
      query: async ({ text }) => {
        assert.equal(
          text,
          'INSERT INTO "Logs" ("startTime", "categoryName", "data", "level", "context") VALUES($1, $2, $3, $4, $5)'
        );
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
  });
});
