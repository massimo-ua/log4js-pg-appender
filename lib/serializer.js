const MAX_DEPTH = 64;
const MAX_NODES = 10000;
const FAST_PATH_MAX_DEPTH = 4;
const FAST_PATH_MAX_NODES = 32;

function isSimplePrimitive(value) {
  const type = typeof value;
  return value === null
    || type === 'string'
    || type === 'number'
    || type === 'boolean'
    || type === 'undefined';
}

function isPlainObject(obj) {
  const proto = Object.getPrototypeOf(obj);
  return proto === Object.prototype || proto === null;
}

function canFastStringify(obj, depth, state) {
  if (depth > FAST_PATH_MAX_DEPTH) {
    return false;
  }
  state.nodes += 1;
  if (state.nodes > FAST_PATH_MAX_NODES) {
    return false;
  }
  if (typeof obj.toJSON === 'function') {
    return false;
  }

  if (Array.isArray(obj)) {
    const len = obj.length;
    if (len > FAST_PATH_MAX_NODES) {
      return false;
    }
    for (let i = 0; i < len; i += 1) {
      const item = obj[i];
      if (!isSimplePrimitive(item)) {
        if (typeof item !== 'object' || !canFastStringify(item, depth + 1, state)) {
          return false;
        }
      }
    }
    return true;
  }

  if (isPlainObject(obj)) {
    let count = 0;
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        count += 1;
        if (count > FAST_PATH_MAX_NODES) {
          return false;
        }
        const val = obj[key];
        if (!isSimplePrimitive(val)) {
          if (typeof val !== 'object' || !canFastStringify(val, depth + 1, state)) {
            return false;
          }
        }
      }
    }
    return true;
  }

  return false;
}

function safeStringify(obj) {
  if (obj === undefined) {
    return undefined;
  }
  const topType = typeof obj;
  if (obj === null || topType === 'string' || topType === 'number' || topType === 'boolean') {
    return JSON.stringify(obj);
  }
  if (topType === 'bigint') {
    return JSON.stringify(obj.toString());
  }

  try {
    if (topType === 'object' && canFastStringify(obj, 0, { nodes: 0 })) {
      return JSON.stringify(obj);
    }

    const ancestors = [];
    const ancestorSet = new Set();
    let visitedNodes = 0;

    return JSON.stringify(obj, function replacer(key, value) {
      if (typeof value === 'bigint') {
        return value.toString();
      }
      if (typeof value === 'object' && value !== null) {
        while (ancestors.length > 0 && ancestors[ancestors.length - 1] !== this) {
          ancestorSet.delete(ancestors.pop());
        }
        if (ancestorSet.has(value)) {
          return '[Circular]';
        }
        if (ancestors.length >= MAX_DEPTH) {
          return '[MaxDepth]';
        }
        visitedNodes += 1;
        if (visitedNodes > MAX_NODES) {
          return '[Truncated]';
        }

        const serialized = value instanceof Error
          ? {
            name: value.name,
            message: value.message,
            stack: value.stack,
          }
          : value;

        ancestors.push(serialized);
        ancestorSet.add(serialized);
        return serialized;
      }
      return value;
    });
  } catch (err) {
    const message = err && typeof err === 'object' && 'message' in err
      ? String(err.message)
      : String(err);
    return JSON.stringify({
      error: 'Failed to serialize log data',
      message,
    });
  }
}

module.exports = safeStringify;
