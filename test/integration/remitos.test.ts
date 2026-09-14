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

// El listado pide ademas el avance por remito, para marcar los completos. Por defecto se
// devuelve remito-1 completo (2 de 2) y remito-2 a medias (1 de 3).
function avanceRule() {
  return {
    match: Markers.avanceRemitos,
    handler: () => [
      { remito_id: 'remito-1', cantidad_escaneada: 2, cantidad_pedida: 2 },
      { remito_id: 'remito-2', cantidad_escaneada: 1, cantidad_pedida: 3 },
    ],
  };
}

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
      makePgDispatcher([{ match: Markers.auth, handler: () => [] }, { match: Markers.remitosDespachoList, handler: () => remitoRows }, avanceRule()]),
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
      makePgDispatcher([authRule(), { match: Markers.remitosDespachoList, handler: () => remitoRows }, avanceRule()]),
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
      cantidadEscaneada: 2,
      cantidadPedida: 2,
    });
    expect(res.body.items).toHaveLength(2);
  });

  it('exactMatch null si el remitoN buscado no matchea ningun item de la lista', async () => {
    queryPgMock.mockImplementation(
      makePgDispatcher([authRule(), { match: Markers.remitosDespachoList, handler: () => remitoRows }, avanceRule()]),
    );

    const res = await request(app.server)
      .get('/remitos/despacho')
      .set('Authorization', basicAuthHeader('jperez', '1234'))
      .query({ remitoN: 'NO-EXISTE' });

    expect(res.status).toBe(200);
    expect(res.body.exactMatch).toBeNull();
    expect(res.body.items).toHaveLength(2);
  });

  // El avance es lo que permite marcar los completos en el listado: la vista de remitos solo
  // filtra por PERMITE_DESPACHO, que lo maneja el ERP y no baja al terminar de cargar un remito.
  it('cada remito trae su avance (escaneado vs pedido)', async () => {
    queryPgMock.mockImplementation(
      makePgDispatcher([authRule(), { match: Markers.remitosDespachoList, handler: () => remitoRows }, avanceRule()]),
    );

    const res = await request(app.server)
      .get('/remitos/despacho')
      .set('Authorization', basicAuthHeader('jperez', '1234'));

    expect(res.status).toBe(200);
    const [uno, dos] = res.body.items;
    // remito-1 completo, remito-2 a medias.
    expect(uno.cantidadEscaneada).toBe(2);
    expect(uno.cantidadPedida).toBe(2);
    expect(dos.cantidadEscaneada).toBe(1);
    expect(dos.cantidadPedida).toBe(3);
  });

  it('un remito sin avance registrado cae a 0/0 y no rompe', async () => {
    queryPgMock.mockImplementation(
      makePgDispatcher([
        authRule(),
        { match: Markers.remitosDespachoList, handler: () => remitoRows },
        { match: Markers.avanceRemitos, handler: () => [] },
      ]),
    );

    const res = await request(app.server)
      .get('/remitos/despacho')
      .set('Authorization', basicAuthHeader('jperez', '1234'));

    expect(res.status).toBe(200);
    expect(res.body.items[0].cantidadEscaneada).toBe(0);
    expect(res.body.items[0].cantidadPedida).toBe(0);
  });

  it('remitoN ausente en la query no rompe: exactMatch null, items completos', async () => {
    queryPgMock.mockImplementation(
      makePgDispatcher([authRule(), { match: Markers.remitosDespachoList, handler: () => remitoRows }, avanceRule()]),
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
      makePgDispatcher([authRule(), { match: Markers.remitosDevolucionList, handler: () => devolucionRows }, avanceRule()]),
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
      // Sin avance registrado para remito-3: cae a 0/0.
      cantidadEscaneada: 0,
      cantidadPedida: 0,
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

  // Un remito puede tener productos de varios tipos y cada fila del listado es uno de esos
  // pedazos: entrar por COCINA tiene que traer solo las cocinas, no el remito entero.
  it('con tipo, la query filtra los items por los productos de ese tipo', async () => {
    queryPgMock.mockImplementation(
      makePgDispatcher([
        authRule(),
        { match: Markers.vistaTransaccion, handler: () => [] },
        { match: Markers.productosRemito, handler: () => [] },
      ]),
    );

    await request(app.server)
      .get('/remitos/remito-1/detalle')
      .set('Authorization', basicAuthHeader('jperez', '1234'))
      .query({ esDespacho: 'true', tipo: 'COCINA' });

    const llamada = queryPgMock.mock.calls.find((c) => Markers.vistaTransaccion(String(c[0])));
    expect(String(llamada?.[0])).toContain('ve_items_remito_despacho');
    expect(llamada?.[1]).toEqual([true, 'remito-1', 'COCINA']);
  });

  it('sin tipo, la query trae el remito completo', async () => {
    queryPgMock.mockImplementation(
      makePgDispatcher([
        authRule(),
        { match: Markers.vistaTransaccion, handler: () => [] },
        { match: Markers.productosRemito, handler: () => [] },
      ]),
    );

    await request(app.server)
      .get('/remitos/remito-1/detalle')
      .set('Authorization', basicAuthHeader('jperez', '1234'))
      .query({ esDespacho: 'true' });

    const llamada = queryPgMock.mock.calls.find((c) => Markers.vistaTransaccion(String(c[0])));
    expect(String(llamada?.[0])).not.toContain('ve_items_remito_despacho');
    expect(llamada?.[1]).toEqual([true, 'remito-1']);
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

  it('la vista de transaccion cae a V_PRODUCTO.DESCRIPCION cuando DESCRIPCIONAPP esta vacia', async () => {
    // DESCRIPCIONAPP se carga a mano en el ERP y esta vacia ('') para casi todos los productos
    // (importados y Peabody incluidos), que por eso aparecian sin descripcion en el listado. El
    // fallback vive en el SQL, asi que lo que se puede verificar aca es que la query lo lleve.
    queryPgMock.mockImplementation(
      makePgDispatcher([authRule(), { match: Markers.vistaTransaccion, handler: () => [] }]),
    );

    await request(app.server)
      .get('/remitos/remito-1/detalle')
      .set('Authorization', basicAuthHeader('jperez', '1234'))
      .query({ esDespacho: 'false' });

    const sqlVistaTransaccion = queryPgMock.mock.calls
      .map(([sql]) => sql as string)
      .find((sql) => Markers.vistaTransaccion(sql));

    const fallback = "COALESCE(NULLIF(EAPRD.DESCRIPCIONAPP, ''), PRD.DESCRIPCION)";
    expect(sqlVistaTransaccion).toContain(fallback);
    // El GROUP BY tiene que agrupar por la MISMA expresion, o Postgres rechaza la query.
    expect(sqlVistaTransaccion!.split(fallback).length - 1).toBe(2);
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
