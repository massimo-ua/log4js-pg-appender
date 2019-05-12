const {Client} = require ('pg');

let db;
module.exports = {
  connect (options) {
    db = new Client (options);
    db.connect ();
    return db;
  },
  disconnect () {
    db.end ();
  },
};
