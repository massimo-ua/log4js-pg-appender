const { Pool, Client } = require('pg');

let db;

function logError(err) {
  console.error(err && err.stack ? err.stack : err);
}

module.exports = {
  createPool(options = {}, onError) {
    const pool = new Pool(options);
    if (pool.options && Object.prototype.hasOwnProperty.call(pool.options, 'connectionString')) {
      Object.defineProperty(pool.options, 'connectionString', {
        configurable: true,
        enumerable: false,
        writable: true,
        value: pool.options.connectionString,
      });
    }
    pool.on('error', (err) => {
      if (typeof onError === 'function') {
        try {
          onError(err);
        } catch (handlerErr) {
          logError(handlerErr);
        }
      } else {
        logError(err);
      }
    });
    return pool;
  },
  connect(options) {
    if (db) {
      return db;
    }
    const client = new Client(options);
    client.on('error', (err) => {
      if (!client._ending) {
        logError(err);
      }
    });
    client.connect().catch((err) => {
      if (!client._ending) {
        logError(err);
      }
    });
    db = client;
    return db;
  },
  disconnect() {
    if (db) {
      const client = db;
      db = null;
      return client.end().catch((err) => {
        logError(err);
      });
    }
  },
};
