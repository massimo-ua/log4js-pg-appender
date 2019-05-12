# log4js-pg-appender
Simple Log4js postgresql appender

## Installation

log4js-pg-appender tested with [log4js](https://github.com/log4js-node/log4js-node/) v3+.

Before you start create table to store records produced by adapter
```
CREATE TABLE public."Logs" (
    "startTime" timestamp with time zone NOT NULL,
    "categoryName" character varying(255) NOT NULL,
    data json NOT NULL,
    level character varying(255),
    context json
);
```
Next install package
```
npm install --save @simoware/log4js-pg-appender
```
Then add appender to log4js configuration

```
{
  appenders: {
    console: {type: 'console'},
    db: {
      type: 'log4js-pg-appender',
      connectionString: 'postgresql://logger:test@postgres/test',
    },
  },
  categories: {
    default: {appenders: ['console', 'db'], level: 'debug'},
  },
}
```
