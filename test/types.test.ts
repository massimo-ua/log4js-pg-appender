import log4js from 'log4js';
import type { LoggingEvent } from 'log4js';
import * as pgAppender from '@simoware/log4js-pg-appender';
import {
  configure,
  DEFAULT_COLUMNS,
  type PgAppenderConfig,
  type PgAppenderLog4jsConfig,
  type PgAppenderFunction,
  type ColumnsConfig,
} from '@simoware/log4js-pg-appender';

// 1. log4js.configure with package name (tests module augmentation)
log4js.configure({
  appenders: {
    db: {
      type: '@simoware/log4js-pg-appender',
      connectionString: 'postgresql://user:pass@localhost:5432/mydb',
      schema: 'public',
      tableName: 'Logs',
      max: 10,
      idleTimeoutMillis: 30000,
      maxPendingWrites: 5000,
      ssl: {
        rejectUnauthorized: false,
        ca: new Uint8Array([1, 2, 3]),
      },
      columns: {
        created_at: 'startTime',
        severity: 'level',
        request_id: 'context.requestId',
        user_id: 'data.1.userId',
        message: (event: LoggingEvent) => String(event.data[0]),
      },
      onError: (err, event) => {
        const msg: string = err.message;
        const cat: string | undefined = event?.categoryName;
        void msg;
        void cat;
      },
    },
    dbExtended: {
      type: pgAppender,
      schema: null,
      tableName: 'Logs',
      columns: {
        ...DEFAULT_COLUMNS,
        request_id: 'context.requestId',
      },
    },
  },
  categories: {
    default: { appenders: ['db', 'dbExtended'], level: 'info' },
  },
});

// 2. Direct configure() usage & returned appender function
const config: PgAppenderConfig = {
  host: 'localhost',
  port: 5432,
  database: 'mydb',
  user: 'postgres',
  password: 'secret',
  ssl: true,
  schema: null,
  tableName: 'audit_logs',
  maxPendingWrites: Infinity,
  columns: {
    ts: 'startTime',
    cat: 'categoryName',
    payload: 'data',
    lvl: 'level',
    ctx: 'context',
    pid: 'pid',
    service: () => 'api',
  },
};

const appenderFn: PgAppenderFunction = configure(config);
const shutdownPromise: Promise<void> = appenderFn.shutdown();
void shutdownPromise;
appenderFn.shutdown((err?: Error) => {
  void err;
});

const poolCount: number = appenderFn.pool.totalCount;
void poolCount;

// 3. Strongly typed PgAppenderLog4jsConfig
const strictLog4jsConfig: PgAppenderLog4jsConfig = {
  type: '@simoware/log4js-pg-appender',
  tableName: 'Logs',
};
void strictLog4jsConfig;

// 4. Negative type checks
// @ts-expect-error configure requires a config object
configure();

const badTableConfig: PgAppenderConfig = {
  // @ts-expect-error tableName must be a string
  tableName: 123,
};
void badTableConfig;

const badSchemaConfig: PgAppenderConfig = {
  // @ts-expect-error schema must be string | null
  schema: 123,
};
void badSchemaConfig;

const badMaxPending: PgAppenderConfig = {
  // @ts-expect-error maxPendingWrites must be a number
  maxPendingWrites: '100',
};
void badMaxPending;

const badColumns: ColumnsConfig = {
  // @ts-expect-error column source must be string or function
  invalid: 42,
};
void badColumns;

// @ts-expect-error DEFAULT_COLUMNS is readonly
DEFAULT_COLUMNS.startTime = 'other';
