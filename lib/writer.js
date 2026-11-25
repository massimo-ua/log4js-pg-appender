const crypto = require('crypto');

const DEFAULT_COLUMNS = ['startTime', 'categoryName', 'data', 'level', 'context'];
const MAX_PG_IDENTIFIER_LENGTH = 63;

function escapeIdentifier(str) {
  if (typeof str !== 'string') {
    throw new Error('SQL identifier must be a string');
  }
  if (str.trim().length === 0) {
    throw new Error('SQL identifier must be a non-empty string');
  }
  if (str.includes('\0')) {
    throw new Error('SQL identifier must not contain null bytes');
  }
  return `"${str.replace(/"/g, '""')}"`;
}

function isDefaultColumns(columns) {
  return columns.length === DEFAULT_COLUMNS.length
    && columns.every((col, idx) => col === DEFAULT_COLUMNS[idx]);
}

function resolveTableIdentifier(tableOrOptions) {
  let schema = null;
  let tableName = 'Logs';
  let columns = DEFAULT_COLUMNS;

  if (typeof tableOrOptions === 'string') {
    if (tableOrOptions.includes('.')) {
      const parts = tableOrOptions.split('.');
      schema = parts[0];
      tableName = parts.slice(1).join('.');
    } else {
      tableName = tableOrOptions;
    }
  } else if (tableOrOptions && typeof tableOrOptions === 'object') {
    schema = tableOrOptions.schema || null;
    tableName = tableOrOptions.tableName || 'Logs';
    if (!schema && tableName.includes('.')) {
      const parts = tableName.split('.');
      schema = parts[0];
      tableName = parts.slice(1).join('.');
    }
    if (Array.isArray(tableOrOptions.columns) && tableOrOptions.columns.length > 0) {
      columns = tableOrOptions.columns;
    }
  }

  const qualifiedName = schema
    ? `${escapeIdentifier(schema)}.${escapeIdentifier(tableName)}`
    : escapeIdentifier(tableName);

  const rawParts = [schema, tableName].filter(Boolean).join('_');
  const cleanParts = rawParts.replace(/[^a-zA-Z0-9_]/g, '_');

  let queryName = `log4js-pg-${cleanParts}`;
  const needsHash = !isDefaultColumns(columns)
    || cleanParts !== rawParts
    || queryName.length > MAX_PG_IDENTIFIER_LENGTH;

  if (needsHash) {
    const hash = crypto
      .createHash('sha256')
      .update(JSON.stringify([schema, tableName, columns]))
      .digest('hex')
      .slice(0, 8);
    const prefix = queryName.slice(0, MAX_PG_IDENTIFIER_LENGTH - hash.length - 1);
    queryName = `${prefix}_${hash}`;
  }

  return { qualifiedName, queryName, columns };
}

module.exports = (client, tableOrOptions = 'Logs') => {
  const { qualifiedName, queryName, columns } = resolveTableIdentifier(tableOrOptions);
  const columnList = columns.map(escapeIdentifier).join(', ');
  const placeholders = columns.map((_, idx) => `$${idx + 1}`).join(', ');
  const queryText = `INSERT INTO ${qualifiedName} (${columnList}) VALUES(${placeholders})`;

  const writeValues = (values) => client.query({
    name: queryName,
    text: queryText,
    values,
  });

  const write = (...values) => writeValues(values);
  write.writeValues = writeValues;
  return write;
};
