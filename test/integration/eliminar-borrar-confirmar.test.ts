import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { makeMssqlDispatcher, makePgDispatcher, Markers } from './testUtils.js';

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

const remitoId = 'remito-3';
const etiqueta = '999';
const tipo = 'COCINA';

function authRule() {
  return { match: Markers.auth, handler: () => [{ usuario: 'JPEREZ', password: '1234' }] };
}

const credenciales = { usuario: 'jperez', password: '1234' };

const app = buildApp();

beforeAll(async () => {
  await app.ready();
});

describe('DELETE /despacho/:remitoId/etiqueta', () => {
  beforeEach(() => {
    queryPgMock.mockReset();
    queryMssqlMock.mockReset();
  });

  it('400 EMPTY_CODE si la etiqueta esta vacia', async () => {
    queryPgMock.mockImplementation(makePgDispatcher([authRule()]));

    const res = await request(app.server)
      .delete(`/despacho/${remitoId}/etiqueta`)
      .send({ ...credenciales, etiqueta: '', tipo });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('EMPTY_CODE');
  });

  it('404 LABEL_INVALID si la etiqueta no existe en el maestro', async () => {
    queryPgMock.mockImplementation(makePgDispatcher([authRule()]));
    queryMssqlMock.mockImplementation(makeMssqlDispatcher([{ match: Markers.etiquetasMaestro, handler: () => [] }]));

    const res = await request(app.server)
      .delete(`/despacho/${remitoId}/etiqueta`)
      .send({ ...credenciales, etiqueta, tipo });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('LABEL_INVALID');
    expect(res.body.error.message).toBe(`El código ${etiqueta} no es válido. Reintente nuevamente.`);
  });

  it('200 success true y borra el registro mas reciente de staging', async () => {
    queryPgMock.mockImplementation(
      makePgDispatcher([
        authRule(),
        { match: Markers.borrarItem, handler: () => [] },
        { match: Markers.vistaTransaccion, handler: () => [] },
      ]),
    );
    queryMssqlMock.mockImplementation(
      makeMssqlDispatcher([
        {
          match: Markers.etiquetasMaestro,
          handler: () => [{ ETIQUETA: etiqueta, TIPO: tipo, PRODUCTO_ID: 'p1', PRODUCTO_N: 'Cocina X', CONTROL_FINAL: true }],
        },
      ]),
    );

    const res = await request(app.server)
      .delete(`/despacho/${remitoId}/etiqueta`)
      .send({ ...credenciales, etiqueta, tipo });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, totalEscaneado: 0 });
  });
});

describe('DELETE /devolucion/:remitoId/etiqueta', () => {
  beforeEach(() => {
    queryPgMock.mockReset();
    queryMssqlMock.mockReset();
  });

  it('400 EMPTY_CODE si la etiqueta esta vacia', async () => {
    queryPgMock.mockImplementation(makePgDispatcher([authRule()]));

    const res = await request(app.server)
      .delete(`/devolucion/${remitoId}/etiqueta`)
      .send({ ...credenciales, etiqueta: '', tipo });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('EMPTY_CODE');
  });

  it('404 LABEL_INVALID si la etiqueta no existe en el maestro', async () => {
    queryPgMock.mockImplementation(makePgDispatcher([authRule()]));
    queryMssqlMock.mockImplementation(makeMssqlDispatcher([{ match: Markers.etiquetasMaestro, handler: () => [] }]));

    const res = await request(app.server)
      .delete(`/devolucion/${remitoId}/etiqueta`)
      .send({ ...credenciales, etiqueta, tipo });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('LABEL_INVALID');
  });

  it('200 success true y borra el registro mas reciente de staging (sin filtrar por es_despacho)', async () => {
    queryPgMock.mockImplementation(
      makePgDispatcher([
        authRule(),
        { match: Markers.borrarItem, handler: () => [] },
        { match: Markers.vistaTransaccion, handler: () => [] },
      ]),
    );
    queryMssqlMock.mockImplementation(
      makeMssqlDispatcher([
        {
          match: Markers.etiquetasMaestro,
          handler: () => [{ ETIQUETA: etiqueta, TIPO: tipo, PRODUCTO_ID: 'p1', PRODUCTO_N: 'Cocina X', CONTROL_FINAL: null }],
        },
      ]),
    );

    const res = await request(app.server)
      .delete(`/devolucion/${remitoId}/etiqueta`)
      .send({ ...credenciales, etiqueta, tipo });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, totalEscaneado: 0 });
  });
});

describe('DELETE /devolucion/:remitoId/transaccion', () => {
  beforeEach(() => {
    queryPgMock.mockReset();
    queryMssqlMock.mockReset();
  });

  it('200 success true, borra todo el staging no migrado del remito (es_despacho=false)', async () => {
    queryPgMock.mockImplementation(makePgDispatcher([authRule(), { match: Markers.borrarTransaccion, handler: () => [] }]));

    const res = await request(app.server).delete(`/devolucion/${remitoId}/transaccion`).send(credenciales);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
  });
});

describe('DELETE /despacho/:remitoId/transaccion', () => {
  beforeEach(() => {
    queryPgMock.mockReset();
    queryMssqlMock.mockReset();
  });

  it('200 success true, borra todo el staging no migrado del remito', async () => {
    queryPgMock.mockImplementation(makePgDispatcher([authRule(), { match: Markers.borrarTransaccion, handler: () => [] }]));

    const res = await request(app.server).delete(`/despacho/${remitoId}/transaccion`).send(credenciales);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
  });
});

describe('POST /despacho/:remitoId/confirmar', () => {
  beforeEach(() => {
    queryPgMock.mockReset();
    queryMssqlMock.mockReset();
  });

  it('422 QUANTITY_MISMATCH si algun item difiere de la cantidad original', async () => {
    queryPgMock.mockImplementation(
      makePgDispatcher([
        authRule(),
        {
          match: Markers.vistaTransaccion,
          handler: () => [
            {
              itemremito_id: 'item-1',
              producto_id: 'p1',
              producto_n: 'Cocina X',
              cantidad: 1,
              cantidad_original: 3,
              cantidad_restante: 2,
            },
          ],
        },
      ]),
    );

    const res = await request(app.server).post(`/despacho/${remitoId}/confirmar`).send(credenciales);

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('QUANTITY_MISMATCH');
    expect(res.body.error.message).toBe(
      'Existen items que difieren de la cantidad original a remitir. Proceso cancelado.',
    );
  });

  it('200 success true si todos los items coinciden con la cantidad original', async () => {
    queryPgMock.mockImplementation(
      makePgDispatcher([
        authRule(),
        {
          match: Markers.vistaTransaccion,
          handler: () => [
            {
              itemremito_id: 'item-1',
              producto_id: 'p1',
              producto_n: 'Cocina X',
              cantidad: 3,
              cantidad_original: 3,
              cantidad_restante: 0,
            },
          ],
        },
      ]),
    );

    const res = await request(app.server).post(`/despacho/${remitoId}/confirmar`).send(credenciales);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
  });
});

describe('POST /devolucion/:remitoId/confirmar', () => {
  beforeEach(() => {
    queryPgMock.mockReset();
    queryMssqlMock.mockReset();
  });

  it('200 success true sin validar cantidades (deshabilitada en el original)', async () => {
    queryPgMock.mockImplementation(makePgDispatcher([authRule()]));

    const res = await request(app.server).post(`/devolucion/${remitoId}/confirmar`).send(credenciales);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
  });

  it('200 success true incluso si existen items con cantidad distinta a la original (nunca valida)', async () => {
    // Se registra la regla de vista de transaccion con diferencias a proposito: si el endpoint
    // alguna vez empezara a validar (regresion), este item forzaria un 422. Ademas se confirma
    // que la query de vista de transaccion ni siquiera se ejecuta (fiel al original comentado).
    queryPgMock.mockImplementation(
      makePgDispatcher([
        authRule(),
        {
          match: Markers.vistaTransaccion,
          handler: () => [
            {
              itemremito_id: 'item-1',
              producto_id: 'p1',
              producto_n: 'Cocina X',
              cantidad: 1,
              cantidad_original: 5,
              cantidad_restante: 4,
            },
          ],
        },
      ]),
    );

    const res = await request(app.server).post(`/devolucion/${remitoId}/confirmar`).send(credenciales);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    const llamoVista = queryPgMock.mock.calls.some(([sql]) => Markers.vistaTransaccion(sql as string));
    expect(llamoVista).toBe(false);
  });
});
