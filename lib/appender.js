const db = require('./db');
const writerFactory = require('./writer');
const { DEFAULT_COLUMNS, validateColumns, compileMapper } = require('./mapper');

const DEFAULT_MAX_PENDING_WRITES = 10000;

function logError(err) {
  console.error(err && err.stack ? err.stack : err);
}

function safeHandleError(errorHandler, err, loggingEvent) {
  try {
    errorHandler(err, loggingEvent);
  } catch (handlerErr) {
    logError(handlerErr);
  }
}

function validateIdentifierOption(name, value) {
  if (value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }
  if (value.includes('\0')) {
    throw new Error(`${name} must not contain null bytes`);
  }
}

function validateConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('config is required');
  }
  if (config.tableName !== undefined) {
    if (typeof config.tableName !== 'string') {
      throw new Error('tableName must be a string');
    }
    validateIdentifierOption('tableName', config.tableName);
  }
  if (config.schema !== undefined && config.schema !== null) {
    if (typeof config.schema !== 'string') {
      throw new Error('schema must be a string or null');
    }
    validateIdentifierOption('schema', config.schema);
  }
  if (config.onError !== undefined && typeof config.onError !== 'function') {
    throw new Error('onError must be a function');
  }
  if (config.maxPendingWrites !== undefined) {
    const isValidMax = config.maxPendingWrites === Infinity
      || (Number.isInteger(config.maxPendingWrites) && config.maxPendingWrites > 0);
    if (!isValidMax) {
      throw new Error('maxPendingWrites must be a positive integer or Infinity');
    }
  }
  validateColumns(config.columns);
}

function resolveTableAndSchema(tableName = 'Logs', schema = 'public') {
  let resolvedSchema = schema;
  let resolvedTable = tableName;

  if (schema === 'public' && tableName.includes('.')) {
    const parts = tableName.split('.');
    resolvedSchema = parts[0];
    resolvedTable = parts.slice(1).join('.');
    validateIdentifierOption('schema', resolvedSchema);
    validateIdentifierOption('tableName', resolvedTable);
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
    columns,
    maxPendingWrites = DEFAULT_MAX_PENDING_WRITES,
  } = config;

  const poolConfig = { ...config };
  delete poolConfig.type;
  delete poolConfig.tableName;
  delete poolConfig.schema;
  delete poolConfig.onError;
  delete poolConfig.columns;
  delete poolConfig.maxPendingWrites;

  const errorHandler = typeof onError === 'function' ? onError : logError;

  const tableInfo = resolveTableAndSchema(tableName, schema);
  const { columnNames, extractValues } = compileMapper(columns);
  const pool = db.createPool(poolConfig, errorHandler);
  const writer = writerFactory(pool, { ...tableInfo, columns: columnNames });

  const pendingWrites = new Set();
  let isShuttingDown = false;
  let shutdownPromise = null;

  const appender = (loggingEvent) => {
    try {
      if (!loggingEvent || isShuttingDown) {
        return;
      }
      if (pendingWrites.size >= maxPendingWrites) {
        safeHandleError(
          errorHandler,
          new Error(`Pending log write queue limit (${maxPendingWrites}) reached; dropping log event`),
          loggingEvent
        );
        return;
      }

      const values = extractValues(loggingEvent);
      const writePromise = Promise.resolve(writer.writeValues(values)).then(
        () => {
          pendingWrites.delete(writePromise);
        },
        (error) => {
          pendingWrites.delete(writePromise);
          safeHandleError(errorHandler, error, loggingEvent);
        }
      );
      pendingWrites.add(writePromise);
    } catch (error) {
      safeHandleError(errorHandler, error, loggingEvent);
    }
  };

  const shutdown = () => {
    if (!shutdownPromise) {
      isShuttingDown = true;
      const drain = pendingWrites.size > 0
        ? Promise.all(pendingWrites)
        : Promise.resolve();
      shutdownPromise = drain.then(() => pool.end());
    }
    return shutdownPromise;
  };

  appender.pool = pool;
  appender.shutdown = (callback) => {
    const promise = shutdown();
    if (typeof callback === 'function') {
      promise.then(
        () => callback(),
        (err) => callback(err)
      );
      return undefined;
    }
    return promise;
  };

  return appender;
}

module.exports.configure = config => createPgAppender(config);
module.exports.DEFAULT_COLUMNS = DEFAULT_COLUMNS;
