import pg from 'pg';
import { config } from '../config/index.js';
import { DbUnavailableError } from '../errors/BusinessError.js';
import { Messages } from '../errors/messages.js';

const { Pool } = pg;

let pool: pg.Pool | null = null;

if (config.pg.configured) {
  pool = new Pool({
    host: config.pg.host,
    port: config.pg.port,
    database: config.pg.database,
    user: config.pg.user,
    password: config.pg.password,
  });
  // No molesta al proceso si una conexion individual falla (pool sigue vivo).
  pool.on('error', () => undefined);
}

export function isPgConfigured(): boolean {
  return pool !== null;
}

export async function queryPg<T = unknown>(text: string, params: unknown[] = []): Promise<T[]> {
  if (!pool) {
    throw new DbUnavailableError(Messages.DB_UNAVAILABLE);
  }
  try {
    const result = await pool.query(text, params);
    return result.rows as T[];
  } catch (err) {
    if (isConnectivityError(err)) {
      throw new DbUnavailableError(Messages.DB_UNAVAILABLE);
    }
    throw err;
  }
}

function isConnectivityError(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  return code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || code === 'ENOTFOUND' || code === '57P03';
}

export async function checkPgHealth(): Promise<boolean> {
  if (!pool) return false;
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

export function getPgPool(): pg.Pool | null {
  return pool;
}
