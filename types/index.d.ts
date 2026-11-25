import type { LoggingEvent } from 'log4js';

export type BuiltInLogField =
  | 'startTime'
  | 'categoryName'
  | 'data'
  | 'level'
  | 'context';

export type ColumnExtractor = (loggingEvent: LoggingEvent) => unknown;

export type ColumnSource =
  | BuiltInLogField
  | (string & {})
  | ColumnExtractor;

export type ColumnsConfig = Record<string, ColumnSource>;

export interface DefaultColumns {
  readonly startTime: 'startTime';
  readonly categoryName: 'categoryName';
  readonly data: 'data';
  readonly level: 'level';
  readonly context: 'context';
}

export interface PgSslOptions {
  rejectUnauthorized?: boolean;
  ca?: string | Uint8Array | ReadonlyArray<string | Uint8Array>;
  key?:
    | string
    | Uint8Array
    | ReadonlyArray<string | Uint8Array | { pem: string | Uint8Array; passphrase?: string }>;
  cert?: string | Uint8Array | ReadonlyArray<string | Uint8Array>;
  pfx?:
    | string
    | Uint8Array
    | ReadonlyArray<string | Uint8Array | { buf: string | Uint8Array; passphrase?: string }>;
  passphrase?: string;
  servername?: string;
  checkServerIdentity?: (host: string, cert: unknown) => Error | undefined;
  [key: string]: unknown;
}

export interface PgPoolOptions {
  connectionString?: string;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string | (() => string | Promise<string>);
  ssl?: boolean | PgSslOptions;
  max?: number;
  min?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
  allowExitOnIdle?: boolean;
  maxUses?: number;
  maxLifetimeSeconds?: number;
  statement_timeout?: number | false;
  query_timeout?: number;
  lock_timeout?: number;
  idle_in_transaction_session_timeout?: number;
  application_name?: string;
  keepAlive?: boolean;
  keepAliveInitialDelayMillis?: number;
  options?: string;
}

export type PgAppenderErrorHandler = (
  error: Error,
  loggingEvent?: LoggingEvent
) => void;

export interface PgAppenderModule {
  configure: typeof configure;
  readonly DEFAULT_COLUMNS: DefaultColumns;
}

export interface PgAppenderConfig extends PgPoolOptions {
  type?: '@simoware/log4js-pg-appender' | PgAppenderModule;
  schema?: string | null;
  tableName?: string;
  columns?: ColumnsConfig;
  maxPendingWrites?: number;
  onError?: PgAppenderErrorHandler;
}

export interface PgAppenderLog4jsConfig extends PgAppenderConfig {
  type: '@simoware/log4js-pg-appender' | PgAppenderModule;
}

export interface PgQueryConfig {
  name?: string;
  text: string;
  values?: unknown[];
}

export interface PgQueryResult<TRow = Record<string, unknown>> {
  rows: TRow[];
  rowCount: number | null;
  command: string;
  oid: number;
  fields: unknown[];
}

export interface PgPoolLike {
  options: PgPoolOptions & Record<string, unknown>;
  readonly totalCount: number;
  readonly idleCount: number;
  readonly waitingCount: number;
  query<TRow = Record<string, unknown>>(
    queryTextOrConfig: string | PgQueryConfig,
    values?: unknown[]
  ): Promise<PgQueryResult<TRow>>;
  end(): Promise<void>;
  end(callback: (error?: Error) => void): void;
  on(event: 'error', listener: (error: Error, client?: unknown) => void): this;
  on(event: string | symbol, listener: (...args: unknown[]) => void): this;
}

export interface PgAppenderFunction {
  (loggingEvent: LoggingEvent): void;
  pool: PgPoolLike;
  shutdown(): Promise<void>;
  shutdown(callback: (error?: Error) => void): void;
}

export const DEFAULT_COLUMNS: DefaultColumns;

export function configure(config: PgAppenderConfig): PgAppenderFunction;

declare module 'log4js' {
  interface Appenders {
    PgAppender: PgAppenderLog4jsConfig;
  }
}
