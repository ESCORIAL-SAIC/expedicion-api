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

const remitoId = 'remito-devolucion-1';
const etiqueta = '54321';
const tipo = 'TERMOTANQUE';
const remitoN = 'R-0002';
const productoId = 'prod-2';
const itemRemitoId = 'item-2';

function authRule() {
  return { match: Markers.auth, handler: () => [{ usuario: 'JPEREZ', password: '1234' }] };
}

function baseBody(overrides: Partial<Record<string, string>> = {}) {
  return { usuario: 'jperez', password: '1234', etiqueta, tipo, remitoN, ...overrides };
}

describe('POST /devolucion/:remitoId/escaneo', () => {
  const app = buildApp();

  beforeAll(async () => {
    await app.ready();
  });

  beforeEach(() => {
    queryPgMock.mockReset();
    queryMssqlMock.mockReset();
  });

  it('409 LABEL_NOT_ENABLED_FOR_RETURN si nunca fue despachada', async () => {
    queryPgMock.mockImplementation(
      makePgDispatcher([authRule(), { match: Markers.ultimoEstadoEtiqueta, handler: () => [] }]),
    );

    const res = await request(app.server).post(`/devolucion/${remitoId}/escaneo`).send(baseBody());

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('LABEL_NOT_ENABLED_FOR_RETURN');
    expect(res.body.error.message).toBe('Esta etiqueta no se encuentra habilitada para devolución.');
  });

  it('404 LABEL_INVALID si no existe en el maestro de etiquetas', async () => {
    queryPgMock.mockImplementation(
      makePgDispatcher([
        authRule(),
        { match: Markers.ultimoEstadoEtiqueta, handler: () => [{ etiqueta, es_despacho: true }] },
      ]),
    );
    queryMssqlMock.mockImplementation(makeMssqlDispatcher([{ match: Markers.etiquetasMaestro, handler: () => [] }]));

    const res = await request(app.server).post(`/devolucion/${remitoId}/escaneo`).send(baseBody());

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('LABEL_INVALID');
    expect(res.body.error.message).toBe(`El código ${etiqueta} no es válido. Reintente nuevamente.`);
  });

  it('200 duplicated true (abort silencioso) si ya esta en staging para el remito', async () => {
    queryPgMock.mockImplementation(
      makePgDispatcher([
        authRule(),
        { match: Markers.ultimoEstadoEtiqueta, handler: () => [{ etiqueta, es_despacho: true }] },
        { match: Markers.existeEtiqueta, handler: () => [{ etiqueta }] },
      ]),
    );
    queryMssqlMock.mockImplementation(
      makeMssqlDispatcher([
        {
          match: Markers.etiquetasMaestro,
          handler: () => [{ ETIQUETA: etiqueta, TIPO: tipo, PRODUCTO_ID: productoId, PRODUCTO_N: 'Termo X', CONTROL_FINAL: null }],
        },
      ]),
    );

    const res = await request(app.server).post(`/devolucion/${remitoId}/escaneo`).send(baseBody());

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ duplicated: true });
  });

  it('422 PRODUCT_NOT_IN_REMITO si el producto no pertenece al remito (sin chequeo de CONTROL_FINAL)', async () => {
    queryPgMock.mockImplementation(
      makePgDispatcher([
        authRule(),
        { match: Markers.ultimoEstadoEtiqueta, handler: () => [{ etiqueta, es_despacho: true }] },
        { match: Markers.existeEtiqueta, handler: () => [] },
        { match: Markers.productosRemito, handler: () => [] },
        { match: Markers.vistaTransaccion, handler: () => [] },
      ]),
    );
    queryMssqlMock.mockImplementation(
      makeMssqlDispatcher([
        {
          // CONTROL_FINAL false a proposito: en devolucion ese paso se omite y no debe rechazar por eso.
          match: Markers.etiquetasMaestro,
          handler: () => [{ ETIQUETA: etiqueta, TIPO: tipo, PRODUCTO_ID: productoId, PRODUCTO_N: 'Termo X', CONTROL_FINAL: false }],
        },
      ]),
    );

    const res = await request(app.server).post(`/devolucion/${remitoId}/escaneo`).send(baseBody());

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('PRODUCT_NOT_IN_REMITO');
  });

  it('422 ITEM_QUOTA_REACHED si el cupo del item ya esta completo', async () => {
    queryPgMock.mockImplementation(
      makePgDispatcher([
        authRule(),
        { match: Markers.ultimoEstadoEtiqueta, handler: () => [{ etiqueta, es_despacho: true }] },
        { match: Markers.existeEtiqueta, handler: () => [] },
        {
          match: Markers.productosRemito,
          handler: () => [{ itemremito_id: itemRemitoId, producto_id: productoId }],
        },
        {
          match: Markers.vistaTransaccion,
          handler: () => [
            {
              itemremito_id: itemRemitoId,
              producto_id: productoId,
              producto_n: 'Termo X',
              cantidad: 1,
              cantidad_original: 1,
              cantidad_restante: 0,
            },
          ],
        },
      ]),
    );
    queryMssqlMock.mockImplementation(
      makeMssqlDispatcher([
        {
          match: Markers.etiquetasMaestro,
          handler: () => [{ ETIQUETA: etiqueta, TIPO: tipo, PRODUCTO_ID: productoId, PRODUCTO_N: 'Termo X', CONTROL_FINAL: null }],
        },
      ]),
    );

    const res = await request(app.server).post(`/devolucion/${remitoId}/escaneo`).send(baseBody());

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('ITEM_QUOTA_REACHED');
    expect(res.body.error.message).toBe('Se ha alcanzado el total del item a remitir.');
  });

  it('201 success true al insertar correctamente', async () => {
    queryPgMock.mockImplementation(
      makePgDispatcher([
        authRule(),
        { match: Markers.ultimoEstadoEtiqueta, handler: () => [{ etiqueta, es_despacho: true }] },
        { match: Markers.existeEtiqueta, handler: () => [] },
        {
          match: Markers.productosRemito,
          handler: () => [{ itemremito_id: itemRemitoId, producto_id: productoId }],
        },
        {
          match: Markers.vistaTransaccion,
          handler: () => [
            {
              itemremito_id: itemRemitoId,
              producto_id: productoId,
              producto_n: 'Termo X',
              cantidad: 0,
              cantidad_original: 2,
              cantidad_restante: 2,
            },
          ],
        },
        { match: Markers.insertStaging, handler: () => [] },
      ]),
    );
    queryMssqlMock.mockImplementation(
      makeMssqlDispatcher([
        {
          match: Markers.etiquetasMaestro,
          handler: () => [{ ETIQUETA: etiqueta, TIPO: tipo, PRODUCTO_ID: productoId, PRODUCTO_N: 'Termo X', CONTROL_FINAL: null }],
        },
      ]),
    );

    const res = await request(app.server).post(`/devolucion/${remitoId}/escaneo`).send(baseBody());

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      success: true,
      productoN: 'Termo X',
      cantidadEscaneada: 0,
      cantidadRestante: 2,
      totalEscaneado: 0,
    });
  });
});
