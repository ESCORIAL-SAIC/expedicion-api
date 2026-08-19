import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { makePgDispatcher, Markers } from './testUtils.js';

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

const etiqueta = '777';

function authRule() {
  return { match: Markers.auth, handler: () => [{ usuario: 'JPEREZ', password: '1234' }] };
}

const credenciales = { usuario: 'jperez', password: '1234' };

describe('POST /etiquetas/estado', () => {
  const app = buildApp();

  beforeAll(async () => {
    await app.ready();
  });

  beforeEach(() => {
    queryPgMock.mockReset();
    queryMssqlMock.mockReset();
  });

  it('200 aborted true (abort silencioso) si el tipo esta vacio', async () => {
    queryPgMock.mockImplementation(makePgDispatcher([authRule()]));

    const res = await request(app.server)
      .post('/etiquetas/estado')
      .send({ ...credenciales, tipo: '', etiqueta });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ aborted: true });
  });

  it('200 aborted true si tipo Y etiqueta estan vacios (el chequeo de tipo va primero)', async () => {
    // Si tipo vacio (abort silencioso) y etiqueta vacia (EMPTY_CODE) aplicarian ambos, debe
    // ganar el abort silencioso por tipo, ya que en el codigo se evalua antes.
    queryPgMock.mockImplementation(makePgDispatcher([authRule()]));

    const res = await request(app.server)
      .post('/etiquetas/estado')
      .send({ ...credenciales, tipo: '', etiqueta: '' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ aborted: true });
  });

  it('400 EMPTY_CODE si la etiqueta esta vacia', async () => {
    queryPgMock.mockImplementation(makePgDispatcher([authRule()]));

    const res = await request(app.server)
      .post('/etiquetas/estado')
      .send({ ...credenciales, tipo: 'COCINA', etiqueta: '' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('EMPTY_CODE');
    expect(res.body.error.message).toBe('No se ha ingresado un código. Reintente nuevamente.');
  });

  it('404 LABEL_NOT_FOUND si la etiqueta no existe', async () => {
    queryPgMock.mockImplementation(makePgDispatcher([authRule(), { match: Markers.estadoInfo, handler: () => [] }]));

    const res = await request(app.server)
      .post('/etiquetas/estado')
      .send({ ...credenciales, tipo: 'COCINA', etiqueta });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('LABEL_NOT_FOUND');
    expect(res.body.error.message).toBe(`El código ${etiqueta} no existe en la base de datos.`);
  });

  it('200 available true si nunca fue despachada', async () => {
    queryPgMock.mockImplementation(
      makePgDispatcher([
        authRule(),
        {
          match: Markers.estadoInfo,
          handler: () => [
            { producto_n: 'Cocina X', expedicion_id: null, es_despacho: null, cliente_n: null, remito_n: null, fechahora: null },
          ],
        },
      ]),
    );

    const res = await request(app.server)
      .post('/etiquetas/estado')
      .send({ ...credenciales, tipo: 'COCINA', etiqueta });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ available: true, productoN: 'Cocina X' });
  });

  it('200 available false con datos del ultimo despacho si ya fue despachada', async () => {
    queryPgMock.mockImplementation(
      makePgDispatcher([
        authRule(),
        {
          match: Markers.estadoInfo,
          handler: () => [
            {
              producto_n: 'Cocina X',
              expedicion_id: 'exp-1',
              es_despacho: true,
              cliente_n: 'Cliente Uno',
              remito_n: 'R-0009',
              fechahora: '2026-08-18 10:00:00',
            },
          ],
        },
      ]),
    );

    const res = await request(app.server)
      .post('/etiquetas/estado')
      .send({ ...credenciales, tipo: 'COCINA', etiqueta });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      available: false,
      clienteN: 'Cliente Uno',
      productoN: 'Cocina X',
      remitoN: 'R-0009',
      fechaHora: '2026-08-18 10:00:00',
    });
  });
});
