import mssql from 'mssql';
import { config } from '../config/index.js';
import { DbUnavailableError } from '../errors/BusinessError.js';
import { Messages } from '../errors/messages.js';

let poolPromise: Promise<mssql.ConnectionPool> | null = null;

export function isMssqlConfigured(): boolean {
  return config.mssql.configured;
}

function getPool(): Promise<mssql.ConnectionPool> {
  if (!config.mssql.configured) {
    return Promise.reject(new DbUnavailableError(Messages.DB_UNAVAILABLE));
  }
  if (!poolPromise) {
    poolPromise = new mssql.ConnectionPool({
      server: config.mssql.host as string,
      port: config.mssql.port,
      database: config.mssql.database,
      user: config.mssql.user,
      password: config.mssql.password,
      options: { trustServerCertificate: true, encrypt: false },
    })
      .connect()
      .catch((err) => {
        poolPromise = null;
        throw err;
      });
  }
  return poolPromise;
}

export async function queryMssql<T = unknown>(
  text: string,
  params: Record<string, unknown> = {},
): Promise<T[]> {
  try {
    const pool = await getPool();
    const request = pool.request();
    for (const [key, value] of Object.entries(params)) {
      request.input(key, value);
    }
    const result = await request.query(text);
    return result.recordset as T[];
  } catch (err) {
    if (err instanceof DbUnavailableError) throw err;
    if (isConnectivityError(err)) {
      throw new DbUnavailableError(Messages.DB_UNAVAILABLE);
    }
    throw err;
  }
}

function isConnectivityError(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  return (
    code === 'ECONNREFUSED' ||
    code === 'ETIMEOUT' ||
    code === 'ETIMEDOUT' ||
    code === 'ENOTFOUND' ||
    code === 'ELOGIN'
  );
}

export async function checkMssqlHealth(): Promise<boolean> {
  if (!config.mssql.configured) return false;
  try {
    const pool = await getPool();
    await pool.request().query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}
