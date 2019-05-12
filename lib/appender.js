const db = require ('./db');
const writerFactory = require ('./writer');

function createPgAppender (config) {
  const client = db.connect (config);
  const writer = writerFactory (client, config.tableName);
  return loggingEvent => {
    const {startTime, categoryName, data, level, context} = loggingEvent;
    writer (
      startTime,
      categoryName,
      JSON.stringify (data),
      level.levelStr,
      JSON.stringify (context)
    ).catch (error => {
      // eslint-disable-next-line no-console
      console.error (error.stack);
    });
  };
}

module.exports.configure = config => createPgAppender (config);
