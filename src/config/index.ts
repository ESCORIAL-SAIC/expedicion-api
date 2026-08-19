import 'dotenv/config';

interface PgConfig {
  configured: boolean;
  host?: string;
  port: number;
  database?: string;
  user?: string;
  password?: string;
}

interface MssqlConfig {
  configured: boolean;
  host?: string;
  port: number;
  database?: string;
  user?: string;
  password?: string;
}

export interface AppConfig {
  port: number;
  logLevel: string;
  pg: PgConfig;
  mssql: MssqlConfig;
}

function readInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function buildPgConfig(): PgConfig {
  const host = process.env.PG_HOST || undefined;
  const database = process.env.PG_DATABASE || undefined;
  const user = process.env.PG_USER || undefined;
  const password = process.env.PG_PASSWORD || undefined;
  const port = readInt(process.env.PG_PORT, 5432);
  const configured = Boolean(host && database && user && password !== undefined);
  return { configured, host, port, database, user, password };
}

function buildMssqlConfig(): MssqlConfig {
  const host = process.env.MSSQL_HOST || undefined;
  const database = process.env.MSSQL_DATABASE || undefined;
  const user = process.env.MSSQL_USER || undefined;
  const password = process.env.MSSQL_PASSWORD || undefined;
  const port = readInt(process.env.MSSQL_PORT, 1433);
  const configured = Boolean(host && database && user && password !== undefined);
  return { configured, host, port, database, user, password };
}

export function loadConfig(): AppConfig {
  return {
    port: readInt(process.env.PORT, 3000),
    logLevel: process.env.LOG_LEVEL || 'info',
    pg: buildPgConfig(),
    mssql: buildMssqlConfig(),
  };
}

export const config = loadConfig();
