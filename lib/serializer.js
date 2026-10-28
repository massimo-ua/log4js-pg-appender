function safeStringify(obj) {
  if (obj === undefined) {
    return undefined;
  }
  const seen = new WeakSet();
  try {
    return JSON.stringify(obj, (key, value) => {
      if (typeof value === 'bigint') {
        return value.toString();
      }
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) {
          return '[Circular]';
        }
        seen.add(value);
      }
      if (value instanceof Error) {
        return {
          name: value.name,
          message: value.message,
          stack: value.stack,
        };
      }
      return value;
    });
  } catch (err) {
    return JSON.stringify({
      error: 'Failed to serialize log data',
      message: err.message,
    });
  }
}

module.exports = safeStringify;
