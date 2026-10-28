const { Pool, Client } = require('pg');

let db;

module.exports = {
  createPool(options = {}, onError) {
    const pool = new Pool(options);
    pool.on('error', (err) => {
      if (typeof onError === 'function') {
        onError(err);
      } else {
        console.error(err.stack || err);
      }
    });
    return pool;
  },
  connect(options) {
    if (db) {
      return db;
    }
    db = new Client(options);
    db.connect();
    return db;
  },
  disconnect() {
    if (db) {
      db.end();
      db = null;
    }
  },
};
