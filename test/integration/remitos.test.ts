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

function authRule() {
  return { match: Markers.auth, handler: () => [{ usuario: 'JPEREZ', password: '1234' }] };
}

function basicAuthHeader(usuario: string, password: string): string {
  return 'Basic ' + Buffer.from(`${usuario}:${password}`).toString('base64');
}

const remitoRows = [
  {
    remito_n: 'R-0001',
    cliente_n: 'Cliente Uno',
    remito_id: 'remito-1',
    cliente_id: 'cliente-1',
    tipo: 'COCINA',
    consignacion: false,
  },
  {
    remito_n: 'R-0002',
    cliente_n: 'Cliente Dos',
    remito_id: 'remito-2',
    cliente_id: 'cliente-2',
    tipo: 'TERMOTANQUE',
    consignacion: true,
  },
];

describe('GET /remitos/despacho', () => {
  const app = buildApp();

  beforeAll(async () => {
    await app.ready();
  });

  beforeEach(() => {
    queryPgMock.mockReset();
    queryMssqlMock.mockReset();
  });

  it('401 INVALID_CREDENTIALS sin header ni body de autenticacion', async () => {
    queryPgMock.mockImplementation(
      makePgDispatcher([{ match: Markers.auth, handler: () => [] }, { match: Markers.remitosDespachoList, handler: () => remitoRows }]),
    );

    const res = await request(app.server).get('/remitos/despacho').query({ remitoN: 'R-0001' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(res.body.error.message).toBe('Datos de acceso incorrectos. Vuelva a intentarlo.');
    const llamoListado = queryPgMock.mock.calls.some(([sql]) => Markers.remitosDespachoList(sql as string));
    expect(llamoListado).toBe(false);
  });

  it('autentica via header Authorization: Basic (GET no tiene body) y devuelve exactMatch + items', async () => {
    queryPgMock.mockImplementation(
      makePgDispatcher([authRule(), { match: Markers.remitosDespachoList, handler: () => remitoRows }]),
    );

    const res = await request(app.server)
      .get('/remitos/despacho')
      .set('Authorization', basicAuthHeader('jperez', '1234'))
      .query({ remitoN: 'R-0001' });

    expect(res.status).toBe(200);
    expect(res.body.exactMatch).toEqual({
      remitoN: 'R-0001',
      clienteN: 'Cliente Uno',
      remitoId: 'remito-1',
      clienteId: 'cliente-1',
      tipo: 'COCINA',
      consignacion: false,
    });
    expect(res.body.items).toHaveLength(2);
  });

  it('exactMatch null si el remitoN buscado no matchea ningun item de la lista', async () => {
    queryPgMock.mockImplementation(
      makePgDispatcher([authRule(), { match: Markers.remitosDespachoList, handler: () => remitoRows }]),
    );

    const res = await request(app.server)
      .get('/remitos/despacho')
      .set('Authorization', basicAuthHeader('jperez', '1234'))
      .query({ remitoN: 'NO-EXISTE' });

    expect(res.status).toBe(200);
    expect(res.body.exactMatch).toBeNull();
    expect(res.body.items).toHaveLength(2);
  });

  it('remitoN ausente en la query no rompe: exactMatch null, items completos', async () => {
    queryPgMock.mockImplementation(
      makePgDispatcher([authRule(), { match: Markers.remitosDespachoList, handler: () => remitoRows }]),
    );

    const res = await request(app.server)
      .get('/remitos/despacho')
      .set('Authorization', basicAuthHeader('jperez', '1234'));

    expect(res.status).toBe(200);
    expect(res.body.exactMatch).toBeNull();
    expect(res.body.items).toHaveLength(2);
  });
});

describe('GET /remitos/devolucion', () => {
  const app = buildApp();

  beforeAll(async () => {
    await app.ready();
  });

  beforeEach(() => {
    queryPgMock.mockReset();
    queryMssqlMock.mockReset();
  });

  it('200 con exactMatch y sin campo consignacion (no aplica a devolucion)', async () => {
    const devolucionRows = [
      { remito_n: 'R-0003', cliente_n: 'Cliente Tres', remito_id: 'remito-3', cliente_id: 'cliente-3', tipo: 'COCINA' },
    ];
    queryPgMock.mockImplementation(
      makePgDispatcher([authRule(), { match: Markers.remitosDevolucionList, handler: () => devolucionRows }]),
    );

    const res = await request(app.server)
      .get('/remitos/devolucion')
      .set('Authorization', basicAuthHeader('jperez', '1234'))
      .query({ remitoN: 'R-0003' });

    expect(res.status).toBe(200);
    expect(res.body.exactMatch).toEqual({
      remitoN: 'R-0003',
      clienteN: 'Cliente Tres',
      remitoId: 'remito-3',
      clienteId: 'cliente-3',
      tipo: 'COCINA',
    });
    expect(res.body.exactMatch.consignacion).toBeUndefined();
  });
});

describe('GET /remitos/:remitoId/detalle', () => {
  const app = buildApp();

  beforeAll(async () => {
    await app.ready();
  });

  beforeEach(() => {
    queryPgMock.mockReset();
    queryMssqlMock.mockReset();
  });

  it('esDespacho=true incluye productosValidos', async () => {
    queryPgMock.mockImplementation(
      makePgDispatcher([
        authRule(),
        {
          match: Markers.vistaTransaccion,
          handler: () => [
            {
              itemremito_id: 'item-1',
              producto_id: 'prod-1',
              producto_n: 'Cocina X',
              cantidad: 1,
              cantidad_original: 3,
              cantidad_restante: 2,
            },
          ],
        },
        { match: Markers.productosRemito, handler: () => [{ itemremito_id: 'item-1', producto_id: 'prod-1' }] },
      ]),
    );

    const res = await request(app.server)
      .get('/remitos/remito-1/detalle')
      .set('Authorization', basicAuthHeader('jperez', '1234'))
      .query({ esDespacho: 'true' });

    expect(res.status).toBe(200);
    expect(res.body.totalEscaneado).toBe(1);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.productosValidos).toEqual([{ itemRemitoId: 'item-1', productoId: 'prod-1' }]);
  });

  it('esDespacho=false NO incluye productosValidos', async () => {
    queryPgMock.mockImplementation(
      makePgDispatcher([authRule(), { match: Markers.vistaTransaccion, handler: () => [] }]),
    );

    const res = await request(app.server)
      .get('/remitos/remito-2/detalle')
      .set('Authorization', basicAuthHeader('jperez', '1234'))
      .query({ esDespacho: 'false' });

    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
    expect(res.body.totalEscaneado).toBe(0);
    expect('productosValidos' in res.body).toBe(false);
    // Con esDespacho=false, la query de productos del remito (Markers.productosRemito) nunca
    // deberia dispararse, solo la de vista de transaccion.
    const llamoProductosRemito = queryPgMock.mock.calls.some(([sql]) => Markers.productosRemito(sql as string));
    expect(llamoProductosRemito).toBe(false);
  });

  it('esDespacho ausente en la query se asume false por defecto', async () => {
    queryPgMock.mockImplementation(
      makePgDispatcher([authRule(), { match: Markers.vistaTransaccion, handler: () => [] }]),
    );

    const res = await request(app.server)
      .get('/remitos/remito-2/detalle')
      .set('Authorization', basicAuthHeader('jperez', '1234'));

    expect(res.status).toBe(200);
    expect('productosValidos' in res.body).toBe(false);
  });

  it('esDespacho con valor arbitrario ("si") se trata como false, no lanza error', async () => {
    queryPgMock.mockImplementation(
      makePgDispatcher([authRule(), { match: Markers.vistaTransaccion, handler: () => [] }]),
    );

    const res = await request(app.server)
      .get('/remitos/remito-2/detalle')
      .set('Authorization', basicAuthHeader('jperez', '1234'))
      .query({ esDespacho: 'si' });

    expect(res.status).toBe(200);
    expect('productosValidos' in res.body).toBe(false);
  });
});
