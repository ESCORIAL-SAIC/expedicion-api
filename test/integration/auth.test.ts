import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

const { queryPgMock, queryMssqlMock } = vi.hoisted(() => ({
  queryPgMock: vi.fn(),
  queryMssqlMock: vi.fn(),
}));

vi.mock('../../src/db/postgres.js', () => ({
  queryPg: queryPgMock,
  isPgConfigured: () => true,
  checkPgHealth: vi.fn(),
  getPgPool: vi.fn(),
}));

vi.mock('../../src/db/mssql.js', () => ({
  queryMssql: queryMssqlMock,
  isMssqlConfigured: () => true,
  checkMssqlHealth: vi.fn(),
}));

const { buildApp } = await import('../../src/app.js');
const { DbUnavailableError } = await import('../../src/errors/BusinessError.js');
const { Messages } = await import('../../src/errors/messages.js');

describe('POST /auth/login', () => {
  const app = buildApp();

  beforeAll(async () => {
    await app.ready();
  });

  beforeEach(() => {
    queryPgMock.mockReset();
    queryMssqlMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('200 valid true con credenciales correctas', async () => {
    queryPgMock.mockResolvedValueOnce([{ usuario: 'JPEREZ', password: '1234' }]);

    const res = await request(app.server).post('/auth/login').send({ usuario: 'jperez', password: '1234' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ valid: true });
  });

  it('401 INVALID_CREDENTIALS con credenciales incorrectas', async () => {
    queryPgMock.mockResolvedValueOnce([]);

    const res = await request(app.server).post('/auth/login').send({ usuario: 'jperez', password: 'mala' });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      error: { code: 'INVALID_CREDENTIALS', message: Messages.INVALID_CREDENTIALS },
    });
  });

  it('503 DB_UNAVAILABLE si no hay conexion a la base de datos', async () => {
    queryPgMock.mockRejectedValueOnce(new DbUnavailableError(Messages.DB_UNAVAILABLE));

    const res = await request(app.server).post('/auth/login').send({ usuario: 'jperez', password: '1234' });

    expect(res.status).toBe(503);
    expect(res.body).toEqual({
      error: { code: 'DB_UNAVAILABLE', message: Messages.DB_UNAVAILABLE },
    });
  });
});
