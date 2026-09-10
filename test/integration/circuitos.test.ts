import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { makePgDispatcher, Markers, EMPLEADO_VALIDO } from './testUtils.js';

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

const remitoId = 'remito-1';
const remitoN = 'R-0001';
const productoId = 'prod-1';
const itemRemitoId = 'item-1';
// EAN de 13 digitos: no cabe en int32, y es el caso real de PEABODY.
const ean = '7791234567890';

function authRule() {
  return { match: Markers.auth, handler: () => [EMPLEADO_VALIDO] };
}

function maestroRule(controlFinal: boolean | null = true) {
  return {
    match: Markers.etiquetasMaestroImportados,
    handler: () => [
      {
        etiqueta: ean,
        tipo: 'PEABODY',
        producto_id: productoId,
        producto_n: 'Producto Peabody',
        control_final: controlFinal,
      },
    ],
  };
}

function productosRule() {
  return {
    match: Markers.productosRemito,
    handler: () => [{ itemremito_id: itemRemitoId, producto_id: productoId }],
  };
}

/** cantidad < cantidadOriginal => hay cupo libre. */
function vistaRule(cantidad = 0, cantidadOriginal = 5) {
  return {
    match: Markers.vistaTransaccion,
    handler: () => [
      {
        itemremito_id: itemRemitoId,
        producto_id: productoId,
        producto_n: 'Producto Peabody',
        cantidad,
        cantidad_original: cantidadOriginal,
        cantidad_restante: cantidadOriginal - cantidad,
      },
    ],
  };
}

function insertRule() {
  return { match: Markers.insertStaging, handler: () => [] };
}

const bodyEscaneo = { ...EMPLEADO_VALIDO, etiqueta: ean, tipo: 'PEABODY', remitoN };

describe('POST /peabody/:remitoId/escaneo', () => {
  const app = buildApp();

  beforeAll(async () => {
    await app.ready();
  });

  beforeEach(() => {
    queryPgMock.mockReset();
    queryMssqlMock.mockReset();
  });

  it('da de alta una etiqueta con cupo libre', async () => {
    queryPgMock.mockImplementation(
      makePgDispatcher([authRule(), maestroRule(), productosRule(), vistaRule(), insertRule()]),
    );

    const res = await request(app.server).post(`/peabody/${remitoId}/escaneo`).send(bodyEscaneo);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.productoN).toBe('Producto Peabody');
  });

  // El caso que justifica el circuito aparte: en despacho normal el segundo escaneo del
  // mismo codigo devuelve 200 {duplicated:true} (ver escaneo-despacho.test.ts). Peabody no
  // tiene numeros de serie -- el mismo EAN llega en todas las unidades -- asi que la segunda
  // unidad DEBE darse de alta igual que la primera.
  it('el mismo codigo escaneado dos veces da de alta las dos (sin numeros de serie)', async () => {
    queryPgMock.mockImplementation(
      makePgDispatcher([authRule(), maestroRule(), productosRule(), vistaRule(), insertRule()]),
    );

    const primera = await request(app.server).post(`/peabody/${remitoId}/escaneo`).send(bodyEscaneo);
    const segunda = await request(app.server).post(`/peabody/${remitoId}/escaneo`).send(bodyEscaneo);

    expect(primera.status).toBe(201);
    expect(segunda.status).toBe(201);
    expect(segunda.body.duplicated).toBeUndefined();
    expect(segunda.body.success).toBe(true);
  });

  // Una query no mockeada lanza excepcion en makePgDispatcher, asi que si el service
  // consultara el duplicado o el ultimo estado, el escaneo terminaria en 500.
  it('no consulta duplicado en staging ni ultimo estado de la etiqueta', async () => {
    queryPgMock.mockImplementation(
      makePgDispatcher([authRule(), maestroRule(), productosRule(), vistaRule(), insertRule()]),
    );

    const res = await request(app.server).post(`/peabody/${remitoId}/escaneo`).send(bodyEscaneo);

    expect(res.status).toBe(201);
    const sqls = queryPgMock.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => Markers.existeEtiqueta(s))).toBe(false);
    expect(sqls.some((s) => Markers.ultimoEstadoEtiqueta(s))).toBe(false);
  });

  it('no valida CONTROL_FINAL: da de alta aunque venga en false', async () => {
    queryPgMock.mockImplementation(
      makePgDispatcher([
        authRule(),
        maestroRule(false),
        productosRule(),
        vistaRule(),
        insertRule(),
      ]),
    );

    const res = await request(app.server).post(`/peabody/${remitoId}/escaneo`).send(bodyEscaneo);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });

  it('usa el TIPO del circuito y no el del body', async () => {
    queryPgMock.mockImplementation(
      makePgDispatcher([authRule(), maestroRule(), productosRule(), vistaRule(), insertRule()]),
    );

    await request(app.server)
      .post(`/peabody/${remitoId}/escaneo`)
      .send({ ...bodyEscaneo, tipo: 'COCINA' });

    const llamadaMaestro = queryPgMock.mock.calls.find((c) =>
      Markers.etiquetasMaestroImportados(String(c[0])),
    );
    expect(llamadaMaestro?.[1]).toEqual([ean, 'PEABODY']);
  });

  it('rechaza codigo vacio con el mensaje de la spec', async () => {
    queryPgMock.mockImplementation(makePgDispatcher([authRule()]));

    const res = await request(app.server)
      .post(`/peabody/${remitoId}/escaneo`)
      .send({ ...bodyEscaneo, etiqueta: '' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('EMPTY_CODE');
    expect(res.body.error.message).toBe('No se ha ingresado un código. Reintente nuevamente.');
  });

  it('rechaza etiqueta que no esta en el maestro de importados', async () => {
    queryPgMock.mockImplementation(
      makePgDispatcher([
        authRule(),
        { match: Markers.etiquetasMaestroImportados, handler: () => [] },
      ]),
    );

    const res = await request(app.server).post(`/peabody/${remitoId}/escaneo`).send(bodyEscaneo);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('LABEL_NOT_FOUND');
    expect(res.body.error.message).toBe(
      `El código ${ean} no existe en la base de datos de etiquetas. Si es correcto, informe a sistemas.`,
    );
  });

  it('rechaza producto que no pertenece al remito', async () => {
    queryPgMock.mockImplementation(
      makePgDispatcher([
        authRule(),
        maestroRule(),
        { match: Markers.productosRemito, handler: () => [] },
        vistaRule(),
      ]),
    );

    const res = await request(app.server).post(`/peabody/${remitoId}/escaneo`).send(bodyEscaneo);

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('PRODUCT_NOT_IN_REMITO');
  });

  // El tope de cantidad sigue vigente: es la unica barrera que queda cuando la etiqueta no
  // es unica, y es lo que evita cargar mas unidades de las que pide el remito.
  it('rechaza cuando el item ya alcanzo la cantidad original', async () => {
    queryPgMock.mockImplementation(
      makePgDispatcher([authRule(), maestroRule(), productosRule(), vistaRule(5, 5)]),
    );

    const res = await request(app.server).post(`/peabody/${remitoId}/escaneo`).send(bodyEscaneo);

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('ITEM_QUOTA_REACHED');
    expect(res.body.error.message).toBe('Se ha alcanzado el total del item a remitir.');
  });

  it('exige autenticacion', async () => {
    queryPgMock.mockImplementation(makePgDispatcher([{ match: Markers.auth, handler: () => [] }]));

    const res = await request(app.server)
      .post(`/peabody/${remitoId}/escaneo`)
      .send({ ...bodyEscaneo, password: 'incorrecta' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });
});

describe('POST /importado/:remitoId/escaneo', () => {
  const app = buildApp();

  beforeAll(async () => {
    await app.ready();
  });

  beforeEach(() => {
    queryPgMock.mockReset();
    queryMssqlMock.mockReset();
  });

  function maestroImportRule() {
    return {
      match: Markers.etiquetasMaestroImportados,
      handler: () => [
        {
          etiqueta: '12345',
          tipo: 'IMPORT',
          producto_id: productoId,
          producto_n: 'Producto Importado',
          control_final: null,
        },
      ],
    };
  }

  const bodyImport = { ...EMPLEADO_VALIDO, etiqueta: '12345', tipo: 'IMPORT', remitoN };

  // IMPORT arranca conservador: mantiene las validaciones de unicidad hasta confirmar si sus
  // etiquetas son unicas por unidad. Si se confirma que se repiten, se apagan los flags en
  // modules/circuitos/config.ts y este test se invierte.
  it('si consulta el ultimo estado de la etiqueta y rechaza si ya fue despachada', async () => {
    queryPgMock.mockImplementation(
      makePgDispatcher([
        authRule(),
        { match: Markers.ultimoEstadoEtiqueta, handler: () => [{ es_despacho: true }] },
      ]),
    );

    const res = await request(app.server).post(`/importado/${remitoId}/escaneo`).send(bodyImport);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('LABEL_ALREADY_DISPATCHED');
  });

  it('si trata el duplicado en staging como abort silencioso (200)', async () => {
    queryPgMock.mockImplementation(
      makePgDispatcher([
        authRule(),
        { match: Markers.ultimoEstadoEtiqueta, handler: () => [] },
        maestroImportRule(),
        { match: Markers.existeEtiqueta, handler: () => [{ etiqueta: '12345' }] },
      ]),
    );

    const res = await request(app.server).post(`/importado/${remitoId}/escaneo`).send(bodyImport);

    expect(res.status).toBe(200);
    expect(res.body.duplicated).toBe(true);
  });

  it('tampoco valida CONTROL_FINAL', async () => {
    queryPgMock.mockImplementation(
      makePgDispatcher([
        authRule(),
        { match: Markers.ultimoEstadoEtiqueta, handler: () => [] },
        maestroImportRule(),
        { match: Markers.existeEtiqueta, handler: () => [] },
        productosRule(),
        vistaRule(),
        insertRule(),
      ]),
    );

    const res = await request(app.server).post(`/importado/${remitoId}/escaneo`).send(bodyImport);

    expect(res.status).toBe(201);
  });
});

describe('GET /remitos/:circuito', () => {
  const app = buildApp();

  beforeAll(async () => {
    await app.ready();
  });

  beforeEach(() => {
    queryPgMock.mockReset();
    queryMssqlMock.mockReset();
  });

  function basicAuthHeader(): string {
    return (
      'Basic ' +
      Buffer.from(`${EMPLEADO_VALIDO.usuario}:${EMPLEADO_VALIDO.password}`).toString('base64')
    );
  }

  // remitosCircuitoList va antes que remitosDespachoList: la query del circuito tambien
  // contiene 'PERMITE_DESPACHO = true' y el dispatcher devuelve la primera que matchea.
  function listRule(tipo: string) {
    return {
      match: Markers.remitosCircuitoList,
      handler: () => [
        {
          remito_n: remitoN,
          cliente_n: 'Cliente Uno',
          remito_id: remitoId,
          cliente_id: 'cliente-1',
          tipo,
          consignacion: false,
        },
      ],
    };
  }

  it('lista los remitos del tipo del circuito', async () => {
    queryPgMock.mockImplementation(makePgDispatcher([authRule(), listRule('PEABODY')]));

    const res = await request(app.server)
      .get('/remitos/peabody')
      .set('Authorization', basicAuthHeader());

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].tipo).toBe('PEABODY');
  });

  it('filtra por TIPO en el SQL y lee la vista de expedicion', async () => {
    queryPgMock.mockImplementation(makePgDispatcher([authRule(), listRule('IMPORT')]));

    await request(app.server).get('/remitos/importado').set('Authorization', basicAuthHeader());

    const llamada = queryPgMock.mock.calls.find((c) =>
      Markers.remitosCircuitoList(String(c[0])),
    );
    expect(llamada?.[1]).toEqual(['IMPORT']);
    // El circuito viejo sigue leyendo vp_itemremito; este NO debe tocarla.
    expect(String(llamada?.[0])).not.toContain('vp_itemremito');
  });

  it('devuelve exactMatch cuando el remitoN coincide', async () => {
    queryPgMock.mockImplementation(makePgDispatcher([authRule(), listRule('PEABODY')]));

    const res = await request(app.server)
      .get(`/remitos/peabody?remitoN=${remitoN}`)
      .set('Authorization', basicAuthHeader());

    expect(res.body.exactMatch?.remitoN).toBe(remitoN);
  });
});

describe('confirmar y borrar transaccion de circuito', () => {
  const app = buildApp();

  beforeAll(async () => {
    await app.ready();
  });

  beforeEach(() => {
    queryPgMock.mockReset();
    queryMssqlMock.mockReset();
  });

  it('confirmar rechaza si algun item difiere de la cantidad original', async () => {
    queryPgMock.mockImplementation(makePgDispatcher([authRule(), vistaRule(2, 5)]));

    const res = await request(app.server)
      .post(`/peabody/${remitoId}/confirmar`)
      .send(EMPLEADO_VALIDO);

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('QUANTITY_MISMATCH');
    expect(res.body.error.message).toBe(
      'Existen items que difieren de la cantidad original a remitir. Proceso cancelado.',
    );
  });

  it('confirmar acepta cuando todos los items estan completos', async () => {
    queryPgMock.mockImplementation(makePgDispatcher([authRule(), vistaRule(5, 5)]));

    const res = await request(app.server)
      .post(`/peabody/${remitoId}/confirmar`)
      .send(EMPLEADO_VALIDO);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('borrar transaccion borra el staging no migrado del remito', async () => {
    queryPgMock.mockImplementation(
      makePgDispatcher([authRule(), { match: Markers.borrarTransaccion, handler: () => [] }]),
    );

    const res = await request(app.server)
      .delete(`/peabody/${remitoId}/transaccion`)
      .send(EMPLEADO_VALIDO);

    expect(res.status).toBe(200);
    const llamada = queryPgMock.mock.calls.find((c) => Markers.borrarTransaccion(String(c[0])));
    expect(llamada?.[1]).toEqual([true, remitoId]);
  });

  it('eliminar etiqueta descuenta una unidad y devuelve el total', async () => {
    queryPgMock.mockImplementation(
      makePgDispatcher([
        authRule(),
        maestroRule(),
        { match: Markers.borrarItem, handler: () => [] },
        vistaRule(2, 5),
      ]),
    );

    const res = await request(app.server)
      .delete(`/peabody/${remitoId}/etiqueta`)
      .send({ ...EMPLEADO_VALIDO, etiqueta: ean, tipo: 'PEABODY' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.totalEscaneado).toBe(2);
  });
});
