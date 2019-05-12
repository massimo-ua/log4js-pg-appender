module.exports = (client, tableName = 'Logs') => {
    const query = {
        name: 'log4js-pg-appender-add-record',
        text: `INSERT INTO "${ tableName }" ("startTime", "categoryName", "data", "level", "context") VALUES($1, $2, $3, $4, $5)`,
    };
    return (...values) => client.query({ ...query, values});
};