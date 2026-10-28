const db = require('./db');
const writerFactory = require('./writer');
const safeStringify = require('./serializer');

function validateConfig(config) {
  if (!config || typeof config !== 'object') {
    throw new Error('config is required');
  }
  if (config.tableName !== undefined && typeof config.tableName !== 'string') {
    throw new Error('tableName must be a string');
  }
  if (config.schema !== undefined && config.schema !== null && typeof config.schema !== 'string') {
    throw new Error('schema must be a string or null');
  }
  if (config.onError !== undefined && typeof config.onError !== 'function') {
    throw new Error('onError must be a function');
  }
}

function resolveTableAndSchema(tableName = 'Logs', schema = 'public') {
  let resolvedSchema = schema;
  let resolvedTable = tableName;

  if (schema === 'public' && tableName.includes('.')) {
    const parts = tableName.split('.');
    resolvedSchema = parts[0];
    resolvedTable = parts.slice(1).join('.');
  }

  return {
    schema: resolvedSchema,
    tableName: resolvedTable,
  };
}

function createPgAppender(config) {
  validateConfig(config);

  const {
    tableName = 'Logs',
    schema = 'public',
    onError,
  } = config;

  const poolConfig = { ...config };
  delete poolConfig.type;
  delete poolConfig.tableName;
  delete poolConfig.schema;
  delete poolConfig.onError;

  const errorHandler = typeof onError === 'function'
    ? onError
    : (err) => console.error(err && err.stack ? err.stack : err);

  const tableInfo = resolveTableAndSchema(tableName, schema);
  const pool = db.createPool(poolConfig, errorHandler);
  const writer = writerFactory(pool, tableInfo);

  const appender = loggingEvent => {
    try {
      if (!loggingEvent) {
        return;
      }
      const { startTime, categoryName, data, level, context } = loggingEvent;
      const serializedData = safeStringify(data);
      const serializedContext = context !== undefined && context !== null ? safeStringify(context) : null;
      const levelStr = level && level.levelStr ? level.levelStr : (level !== null && level !== undefined ? String(level) : '');

      writer(
        startTime || new Date(),
        categoryName || '',
        serializedData,
        levelStr,
        serializedContext
      ).catch(error => {
        errorHandler(error, loggingEvent);
      });
    } catch (error) {
      errorHandler(error, loggingEvent);
    }
  };

  appender.pool = pool;
  appender.shutdown = (callback) => {
    if (typeof callback === 'function') {
      pool.end()
        .then(() => callback())
        .catch(err => callback(err));
    } else {
      return pool.end();
    }
  };

  return appender;
}

module.exports.configure = config => createPgAppender(config);
