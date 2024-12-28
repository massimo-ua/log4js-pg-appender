const {Client} = require ('pg');

let db;
module.exports = {
  connect (options) {
    if (db) {
      return db;
    }
    db = new Client (options);
    db.connect ();
    return db;
  },
  disconnect () {
    if (db) {
      db.end();
      db = null;
    }
  },
};
