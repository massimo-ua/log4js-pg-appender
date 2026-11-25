const safeStringify = require('./serializer');

const DEFAULT_COLUMNS = Object.freeze({
  startTime: 'startTime',
  categoryName: 'categoryName',
  data: 'data',
  level: 'level',
  context: 'context',
});

const FORBIDDEN_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

const BUILT_IN_EXTRACTORS = {
  startTime: (event) => event.startTime || new Date(),
  categoryName: (event) => event.categoryName || '',
  data: (event) => safeStringify(event.data),
  level: (event) => {
    const { level } = event;
    return level && level.levelStr
      ? level.levelStr
      : (level !== null && level !== undefined ? String(level) : '');
  },
  context: (event) => (
    event.context !== undefined && event.context !== null
      ? safeStringify(event.context)
      : null
  ),
};

function isPlainObject(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function validateColumns(columns) {
  if (columns === undefined) {
    return;
  }
  if (!isPlainObject(columns)) {
    throw new Error('columns must be a plain object');
  }
  const entries = Object.entries(columns);
  if (entries.length === 0) {
    throw new Error('columns must define at least one column');
  }
  for (const [columnName, source] of entries) {
    if (columnName.trim().length === 0) {
      throw new Error('column name must be a non-empty string');
    }
    if (columnName.includes('\0')) {
      throw new Error('column name must not contain null bytes');
    }
    if (typeof source === 'function') {
      continue;
    }
    if (typeof source !== 'string' || source.trim().length === 0) {
      throw new Error(`column "${columnName}" mapping must be a non-empty string or function`);
    }
    const segments = source.split('.');
    if (segments.some((seg) => seg.trim().length === 0)) {
      throw new Error(`column "${columnName}" has invalid path "${source}"`);
    }
    if (segments.some((seg) => FORBIDDEN_SEGMENTS.has(seg))) {
      throw new Error(`column "${columnName}" path "${source}" contains forbidden segment`);
    }
  }
}

function getByPath(obj, segments) {
  let current = obj;
  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i];
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    if (
      FORBIDDEN_SEGMENTS.has(segment)
      || (segment in Object.prototype && !Object.prototype.hasOwnProperty.call(current, segment))
    ) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

function serializeValue(value) {
  if (value === undefined || value === null || typeof value === 'function') {
    return null;
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (value instanceof Date || Buffer.isBuffer(value)) {
    return value;
  }
  if (typeof value === 'object') {
    return safeStringify(value);
  }
  return String(value);
}

function compilePathExtractor(segments) {
  const inObjectProto = segments.map((seg) => seg in Object.prototype);

  if (segments.length === 1 && !inObjectProto[0]) {
    const s0 = segments[0];
    return (event) => (
      event && typeof event === 'object' ? serializeValue(event[s0]) : null
    );
  }

  if (segments.length === 2 && !inObjectProto[0] && !inObjectProto[1]) {
    const s0 = segments[0];
    const s1 = segments[1];
    return (event) => {
      if (!event || typeof event !== 'object') {
        return null;
      }
      const v0 = event[s0];
      if (!v0 || typeof v0 !== 'object') {
        return null;
      }
      return serializeValue(v0[s1]);
    };
  }

  const len = segments.length;
  return (event) => {
    let current = event;
    for (let i = 0; i < len; i += 1) {
      if (current === null || current === undefined || typeof current !== 'object') {
        return null;
      }
      const segment = segments[i];
      if (inObjectProto[i] && !Object.prototype.hasOwnProperty.call(current, segment)) {
        return null;
      }
      current = current[segment];
    }
    return serializeValue(current);
  };
}

function compileMapper(columns) {
  validateColumns(columns);
  const resolvedColumns = columns || DEFAULT_COLUMNS;
  const rawEntries = Object.entries(resolvedColumns);
  const len = rawEntries.length;
  const columnNames = new Array(len);
  const extractors = new Array(len);

  for (let i = 0; i < len; i += 1) {
    const [column, source] = rawEntries[i];
    columnNames[i] = column;

    if (typeof source === 'function') {
      extractors[i] = (event) => serializeValue(source(event));
    } else if (Object.prototype.hasOwnProperty.call(BUILT_IN_EXTRACTORS, source)) {
      extractors[i] = BUILT_IN_EXTRACTORS[source];
    } else {
      extractors[i] = compilePathExtractor(source.split('.'));
    }
  }

  const extractValues = (loggingEvent) => {
    const values = new Array(len);
    for (let i = 0; i < len; i += 1) {
      values[i] = extractors[i](loggingEvent);
    }
    return values;
  };

  return {
    columnNames,
    extractValues,
  };
}

module.exports = {
  DEFAULT_COLUMNS,
  validateColumns,
  compileMapper,
  serializeValue,
  getByPath,
};
