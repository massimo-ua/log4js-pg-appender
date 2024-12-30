const db = require ('./db');
const writerFactory = require ('./writer');

function validateConfig(config) {
  if (!config) {throw new Error('config is required');}
  if (!config.host) {throw new Error('host is required');}
  if (!config.database) {throw new Error('database is required');}
  if (!config.user) {throw new Error('user is required');}
  if (!config.password) {throw new Error('password is required');}
  if (!config.tableName) {throw new Error('tableName is required');}
}

function createPgAppender (config) {
  validateConfig(config);
  const client = db.connect (config);
  const writer = writerFactory (client, config.tableName);
  return loggingEvent => {
    const {startTime, categoryName, data, level, context} = loggingEvent;
    writer (
      startTime,
      categoryName,
      JSON.stringify (data),
      level.levelStr,
      context ? JSON.stringify (context) : null
    ).catch (error => {
       
      console.error (error.stack);
    });
  };
}

module.exports.configure = config => createPgAppender (config);
