import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

const { checkPgHealthMock, checkMssqlHealthMock } = vi.hoisted(() => ({
  checkPgHealthMock: vi.fn(),
  checkMssqlHealthMock: vi.fn(),
}));

vi.mock('../../src/db/postgres.js', () => ({
  queryPg: vi.fn(),
  isPgConfigured: () => true,
  checkPgHealth: checkPgHealthMock,
  getPgPool: vi.fn(),
}));

vi.mock('../../src/db/mssql.js', () => ({
  queryMssql: vi.fn(),
  isMssqlConfigured: () => true,
  checkMssqlHealth: checkMssqlHealthMock,
}));

const { buildApp } = await import('../../src/app.js');

describe('GET /version', () => {
  const app = buildApp();

  beforeAll(async () => {
    await app.ready();
  });

  afterEach(() => {
    delete process.env.APP_VERSION;
  });

  it('devuelve "dev" si APP_VERSION no esta seteada', async () => {
    delete process.env.APP_VERSION;

    const res = await request(app.server).get('/version');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ version: 'dev' });
  });

  it('devuelve el valor de APP_VERSION cuando esta seteada', async () => {
    process.env.APP_VERSION = '1.2.3';

    const res = await request(app.server).get('/version');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ version: '1.2.3' });
  });
});

describe('GET /health/live', () => {
  const app = buildApp();

  beforeAll(async () => {
    await app.ready();
  });

  it('200 sin tocar la DB, incluso si los checks de DB fallarian', async () => {
    checkPgHealthMock.mockRejectedValue(new Error('no deberia llamarse'));
    checkMssqlHealthMock.mockRejectedValue(new Error('no deberia llamarse'));

    const res = await request(app.server).get('/health/live');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
    expect(checkPgHealthMock).not.toHaveBeenCalled();
    expect(checkMssqlHealthMock).not.toHaveBeenCalled();
  });
});

describe('GET /health (alias de compatibilidad)', () => {
  const app = buildApp();

  beforeAll(async () => {
    await app.ready();
  });

  it('200 igual que /health/live', async () => {
    const res = await request(app.server).get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});

describe('GET /health/ready', () => {
  const app = buildApp();

  beforeAll(async () => {
    await app.ready();
  });

  beforeEach(() => {
    checkPgHealthMock.mockReset();
    checkMssqlHealthMock.mockReset();
  });

  it('200 si Postgres y SQL Server responden', async () => {
    checkPgHealthMock.mockResolvedValue(true);
    checkMssqlHealthMock.mockResolvedValue(true);

    const res = await request(app.server).get('/health/ready');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', checks: { postgres: 'ok', mssql: 'ok' } });
  });

  it('503 con detalle si Postgres esta caido', async () => {
    checkPgHealthMock.mockResolvedValue(false);
    checkMssqlHealthMock.mockResolvedValue(true);

    const res = await request(app.server).get('/health/ready');

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'error', checks: { postgres: 'error', mssql: 'ok' } });
  });

  it('503 con detalle si SQL Server esta caido', async () => {
    checkPgHealthMock.mockResolvedValue(true);
    checkMssqlHealthMock.mockResolvedValue(false);

    const res = await request(app.server).get('/health/ready');

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'error', checks: { postgres: 'ok', mssql: 'error' } });
  });

  it('503 con detalle si ambas bases estan caidas', async () => {
    checkPgHealthMock.mockResolvedValue(false);
    checkMssqlHealthMock.mockResolvedValue(false);

    const res = await request(app.server).get('/health/ready');

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'error', checks: { postgres: 'error', mssql: 'error' } });
  });
});
