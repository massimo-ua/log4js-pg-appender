function escapeIdentifier(str) {
  return `"${String(str).replace(/"/g, '""')}"`;
}

function resolveTableIdentifier(tableOrOptions) {
  let schema = null;
  let tableName = 'Logs';

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
  }

  const qualifiedName = schema
    ? `${escapeIdentifier(schema)}.${escapeIdentifier(tableName)}`
    : escapeIdentifier(tableName);

  const cleanParts = [schema, tableName]
    .filter(Boolean)
    .join('_')
    .replace(/[^a-zA-Z0-9_]/g, '_');

  const queryName = `log4js-pg-${cleanParts}`;

  return { qualifiedName, queryName };
}

module.exports = (client, tableOrOptions = 'Logs') => {
  const { qualifiedName, queryName } = resolveTableIdentifier(tableOrOptions);
  const query = {
    name: queryName,
    text: `INSERT INTO ${qualifiedName} ("startTime", "categoryName", "data", "level", "context") VALUES($1, $2, $3, $4, $5)`,
  };
  return (...values) => client.query({ ...query, values });
};
