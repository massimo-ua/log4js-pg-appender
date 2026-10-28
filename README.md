# log4js-pg-appender
Simple Log4js PostgreSQL appender with connection pooling, robust error handling, and safe serialization.

## Installation

`log4js-pg-appender` is compatible with [log4js](https://github.com/log4js-node/log4js-node/) v3+.

Before you start, create a table to store records produced by the appender:

```sql
CREATE TABLE public."Logs" (
    "startTime" timestamp with time zone NOT NULL,
    "categoryName" character varying(255) NOT NULL,
    data json NOT NULL,
    level character varying(255),
    context json
);
```

Next install the package:

```bash
npm install --save @simoware/log4js-pg-appender
```

## Configuration

Add the appender to your log4js configuration. You can connect using a `connectionString`, individual connection parameters, or standard `PG*` environment variables.

### Example 1: Using `connectionString`

```javascript
const log4js = require('log4js');

log4js.configure({
  appenders: {
    console: { type: 'console' },
    db: {
      type: '@simoware/log4js-pg-appender',
      connectionString: 'postgresql://logger:test@postgres:5432/test',
      schema: 'public', // optional, defaults to 'public'
      tableName: 'Logs', // optional, defaults to 'Logs'
    },
  },
  categories: {
    default: { appenders: ['console', 'db'], level: 'debug' },
  },
});
```

### Example 2: Using connection parameters & pool options

```javascript
const log4js = require('log4js');

log4js.configure({
  appenders: {
    db: {
      type: '@simoware/log4js-pg-appender',
      host: 'localhost',
      port: 5432,
      database: 'mydb',
      user: 'postgres',
      password: 'password',
      tableName: 'Logs',
      schema: 'public',
      max: 10, // pool options passed directly to pg.Pool
      idleTimeoutMillis: 30000,
      onError: (err, loggingEvent) => {
        // optional custom error handler
        console.error('Failed to write log to PostgreSQL:', err.message);
      },
    },
  },
  categories: {
    default: { appenders: ['db'], level: 'info' },
  },
});
```

### Configuration Options

| Option | Type | Default | Description |
|---|---|---|---|
| `connectionString` | `string` | `undefined` | PostgreSQL connection URL (e.g. `postgresql://user:pass@host:port/db`) |
| `host` | `string` | `undefined` | PostgreSQL server host (falls back to `PGHOST` env var or localhost) |
| `port` | `number` | `undefined` | PostgreSQL server port (falls back to `PGPORT` env var or 5432) |
| `database` | `string` | `undefined` | Database name (falls back to `PGDATABASE` env var) |
| `user` | `string` | `undefined` | Database user (falls back to `PGUSER` env var) |
| `password` | `string` | `undefined` | Database password (falls back to `PGPASSWORD` env var) |
| `ssl` | `boolean \| object` | `undefined` | SSL connection options |
| `schema` | `string \| null` | `'public'` | Schema name. Set to `null` to disable schema prefix |
| `tableName` | `string` | `'Logs'` | Target table name. Can also be formatted as `'schema.table'` |
| `onError` | `function` | `console.error` | Error handler callback `(error, loggingEvent) => void` |
| `max` | `number` | `10` | Maximum connections in the pool |
| `idleTimeoutMillis`| `number` | `10000` | How long a client is allowed to remain idle before being closed |
| `connectionTimeoutMillis` | `number` | `0` | Milliseconds to wait for a connection from the pool before timing out |

## Graceful Shutdown

When shutting down your application, invoke `log4js.shutdown()` to cleanly drain and close PostgreSQL connection pools:

```javascript
log4js.shutdown((err) => {
  if (err) {
    console.error('Error shutting down log4js:', err);
  }
  process.exit(0);
});
```
