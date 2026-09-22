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

/**
 * Peabody resuelve el producto por EAN/DUN contra V_UD_PRODUCTO, no contra un maestro de
 * etiquetas: esos productos no tienen numero de serie, y su EAN y DUN son los mismos para todas
 * las unidades. Por eso la fila no trae ni tipo ni control_final.
 */
function maestroRule(unidades = 1, esDun = false) {
  return {
    match: Markers.productoPorCodigo,
    handler: () => [
      {
        producto_id: productoId,
        producto_n: 'Producto Peabody',
        es_dun: esDun,
        unidades,
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

  // El tipo del body se ignora: Peabody resuelve el producto por el codigo contra V_UD_PRODUCTO,
  // sin maestro de etiquetas de por medio, y el TIPO sale siempre de la config del circuito.
  it('resuelve el producto por el codigo y no consulta el maestro de etiquetas', async () => {
    queryPgMock.mockImplementation(
      makePgDispatcher([authRule(), maestroRule(), productosRule(), vistaRule(), insertRule()]),
    );

    const res = await request(app.server)
      .post(`/peabody/${remitoId}/escaneo`)
      .send({ ...bodyEscaneo, tipo: 'COCINA' });

    expect(res.status).toBe(201);
    const llamadaProducto = queryPgMock.mock.calls.find((c) =>
      Markers.productoPorCodigo(String(c[0])),
    );
    expect(llamadaProducto?.[1]).toEqual([ean]);
    const consultoEtiquetas = queryPgMock.mock.calls.some((c) =>
      Markers.etiquetasMaestroImportados(String(c[0])),
    );
    expect(consultoEtiquetas).toBe(false);
  });

  // Un DUN es una caja entera: descuenta UNIDADESPORBULTO de una, y deja una fila por unidad
  // (la vista de transaccion cuenta filas).
  it('un DUN carga tantas filas como unidades trae la caja', async () => {
    queryPgMock.mockImplementation(
      makePgDispatcher([
        authRule(),
        maestroRule(3, true),
        productosRule(),
        vistaRule(0, 5),
        insertRule(),
      ]),
    );

    const res = await request(app.server)
      .post(`/peabody/${remitoId}/escaneo`)
      .send({ ...bodyEscaneo, etiqueta: '1' + ean });

    expect(res.status).toBe(201);
    const inserts = queryPgMock.mock.calls.filter((c) => Markers.insertStaging(String(c[0])));
    expect(inserts).toHaveLength(3);
  });

  // Si la caja no entra en lo que falta no se carga NADA: partirla dejaria unidades fisicas sin
  // registrar. El operario completa con EAN sueltos.
  it('rechaza el DUN entero si no entra en el cupo restante', async () => {
    queryPgMock.mockImplementation(
      makePgDispatcher([
        authRule(),
        maestroRule(3, true),
        productosRule(),
        // 3 de 5: quedan 2, la caja trae 3.
        vistaRule(3, 5),
      ]),
    );

    const res = await request(app.server)
      .post(`/peabody/${remitoId}/escaneo`)
      .send({ ...bodyEscaneo, etiqueta: '1' + ean });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('ITEM_QUOTA_REACHED');
    const inserts = queryPgMock.mock.calls.filter((c) => Markers.insertStaging(String(c[0])));
    expect(inserts).toHaveLength(0);
  });

  it('un EAN suelto carga una sola unidad aunque el producto venga en cajas', async () => {
    queryPgMock.mockImplementation(
      makePgDispatcher([authRule(), maestroRule(1), productosRule(), vistaRule(4, 5), insertRule()]),
    );

    const res = await request(app.server).post(`/peabody/${remitoId}/escaneo`).send(bodyEscaneo);

    expect(res.status).toBe(201);
    const inserts = queryPgMock.mock.calls.filter((c) => Markers.insertStaging(String(c[0])));
    expect(inserts).toHaveLength(1);
  });

  // El DUN de la caja master resuelve al mismo producto que el EAN de la unidad: el operario
  // puede escanear cualquiera de los dos.
  it('acepta el DUN ademas del EAN', async () => {
    queryPgMock.mockImplementation(
      makePgDispatcher([authRule(), maestroRule(), productosRule(), vistaRule(), insertRule()]),
    );

    const dun = '1' + ean;
    const res = await request(app.server)
      .post(`/peabody/${remitoId}/escaneo`)
      .send({ ...bodyEscaneo, etiqueta: dun });

    expect(res.status).toBe(201);
    const llamadaProducto = queryPgMock.mock.calls.find((c) =>
      Markers.productoPorCodigo(String(c[0])),
    );
    expect(llamadaProducto?.[1]).toEqual([dun]);
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

  it('rechaza un codigo que no corresponde a ningun producto', async () => {
    queryPgMock.mockImplementation(
      makePgDispatcher([authRule(), { match: Markers.productoPorCodigo, handler: () => [] }]),
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

  // Forma REAL de la fila que devuelve vp_etiquetas_con_importados (leida de pg_views contra
  // produccion el 2026-09-16). Ojo con dos campos, que antes estaban mal en este mock y por eso
  // los tests confirmaban el bug en vez de detectarlo:
  //   - `tipo` es 'IMPORTADO', no 'IMPORT'. El del listado de remitos SI es 'IMPORT'.
  //   - NO hay control_final: la vista no expone esa columna.
  function maestroImportRule() {
    return {
      match: Markers.etiquetasMaestroImportados,
      handler: () => [
        {
          etiqueta: SERIE_IMPORT,
          tipo: 'IMPORTADO',
          producto_id: productoId,
          producto_n: 'Producto Importado',
        },
      ],
    };
  }

  // Las series reales son de 18 digitos exactos (10371 filas, min = max = 18).
  const SERIE_IMPORT = '100000000000012345';

  const bodyImport = { ...EMPLEADO_VALIDO, etiqueta: SERIE_IMPORT, tipo: 'IMPORT', remitoN };

  // ---------------------------------------------------------------------------------------
  // Regresion: el circuito IMPORT nunca funciono contra la base real, y estos tests pasaban
  // igual. Los mocks rutean por `includes('vp_etiquetas_con_importados')`, asi que no ven ni
  // las columnas que pide el SELECT ni el valor de TIPO: cualquier query con ese texto
  // matcheaba. Los tres fallos se encadenaban, cada uno tapado por el anterior:
  //
  //   1. 42703  la vista NO tiene columna control_final, y el SELECT la pedia.
  //   2. 0 filas  la vista emite TIPO 'IMPORTADO' y se le pasaba 'IMPORT'.
  //   3. 22003  `numero` esta truncado a 9 digitos y es int4; la serie es de 18.
  //
  // Estos tests miran el SQL y los parametros, que es lo unico que un mock puede fijar. La
  // verificacion de que la vista realmente se comporta asi esta en local-test/init.sql, que
  // ahora la replica con el DDL leido de produccion.
  // ---------------------------------------------------------------------------------------
  it('no le pide CONTROL_FINAL al maestro de importados (la vista no tiene esa columna)', async () => {
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

    await request(app.server).post(`/importado/${remitoId}/escaneo`).send(bodyImport);

    const sql = queryPgMock.mock.calls
      .map(([s]) => String(s))
      .find((s) => Markers.etiquetasMaestroImportados(s));
    expect(sql).toBeDefined();
    expect(sql).not.toMatch(/CONTROL_FINAL/i);
  });

  // El TIPO del maestro ('IMPORTADO') no es el del listado de remitos ('IMPORT'). Son dos
  // vocabularios distintos y config.ts los separa en `tipo` y `tipoMaestro`.
  it('consulta el maestro con TIPO = IMPORTADO, no IMPORT', async () => {
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

    await request(app.server).post(`/importado/${remitoId}/escaneo`).send(bodyImport);

    const llamada = queryPgMock.mock.calls.find((c) =>
      Markers.etiquetasMaestroImportados(String(c[0])),
    );
    expect(llamada?.[1]).toEqual([SERIE_IMPORT, 'IMPORTADO']);
  });

  // Compara contra NUMERO_COMPLETO y no contra NUMERO: este ultimo viene truncado a los
  // ultimos 9 digitos por la propia vista, y ademas es int4 -- una serie de 18 digitos lo
  // desborda con 22003 antes de leer una sola fila.
  //
  // Truncar tampoco seria correcto aunque entrara: las 10371 series activas son unicas 1 a 1,
  // pero sus sufijos de 9 colapsan en 9911 (460 cruces). Si dos de esos cruces caen en
  // productos distintos del MISMO remito, el filtro por remito no desambigua y se despacha el
  // producto equivocado.
  it('compara la serie completa, no el NUMERO truncado a 9 digitos', async () => {
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

    await request(app.server).post(`/importado/${remitoId}/escaneo`).send(bodyImport);

    const [sql, params] = queryPgMock.mock.calls.find((c) =>
      Markers.etiquetasMaestroImportados(String(c[0])),
    ) as [string, unknown[]];

    expect(sql).toMatch(/NUMERO_COMPLETO\s*=\s*\$1/i);
    // El WHERE no compara contra la columna truncada.
    expect(sql).not.toMatch(/ET\.NUMERO\s*=\s*\$1/i);
    // Y la serie viaja entera: 18 digitos, sin normalizar a 9.
    expect(params[0]).toBe(SERIE_IMPORT);
    expect(String(params[0])).toHaveLength(18);
  });

  // ---------------------------------------------------------------------------------------
  // Ruteo de tablas de staging. El staging vive en DOS tablas porque aux_expedicion.etiqueta es
  // integer y no se pudo ampliar (siete vistas dependientes, una de ellas base de
  // COCINA/TERMOTANQUE -- ver migrations/001-staging-circuitos.sql).
  //
  // Escribir en la tabla equivocada no da error de tipos ni rompe ningun test existente: falla
  // recien contra la base, con 22003, que es exactamente el bug que se esta arreglando. De ahi
  // que estos tests miren el SQL.
  // ---------------------------------------------------------------------------------------
  it('escribe en aux_expedicion_circuitos y nunca en la tabla clasica', async () => {
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
    const sqls = queryPgMock.mock.calls.map(([s]) => String(s));
    expect(sqls.some((s) => Markers.insertStagingCircuitos(s))).toBe(true);
    expect(sqls.some((s) => Markers.insertStagingClasico(s))).toBe(false);
  });

  // Las consultas por etiqueta tambien: preguntarle a la tabla clasica por una serie de 18
  // digitos da 22003, no "no encontrada".
  it('consulta ultimo estado y duplicado contra aux_expedicion_circuitos', async () => {
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

    await request(app.server).post(`/importado/${remitoId}/escaneo`).send(bodyImport);

    const sqls = queryPgMock.mock.calls.map(([s]) => String(s));
    for (const marker of [Markers.ultimoEstadoEtiqueta, Markers.existeEtiqueta]) {
      const sql = sqls.find((s) => marker(s));
      expect(sql).toBeDefined();
      expect(sql).toMatch(/aux_expedicion_circuitos/i);
    }
  });

  // El conteo tiene que ver LAS DOS tablas: un remito mixto COCINA+IMPORT tiene filas en cada
  // una, y contar solo la del circuito daria un avance corto que nunca llega a completo.
  it('cuenta el avance contra la vista unificada, no contra una sola tabla', async () => {
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

    await request(app.server).post(`/importado/${remitoId}/escaneo`).send(bodyImport);

    const sql = queryPgMock.mock.calls.map(([s]) => String(s)).find((s) => Markers.vistaTransaccion(s));
    expect(sql).toBeDefined();

    // Las clausulas, no el texto suelto: los comentarios de esta query MENCIONAN la vista, asi
    // que un /V_AUX_EXPEDICION_TODO/ a secas pasa incluso con el FROM apuntando a la tabla vieja.
    const sinComentarios = (sql as string).replace(/--[^\n]*/g, '');
    expect(sinComentarios).toMatch(/FROM\s+public\.V_AUX_EXPEDICION_TODO/i);
    expect(sinComentarios).toMatch(/JOIN\s+public\.V_AUX_EXPEDICION_TODO/i);
    expect(sinComentarios).not.toMatch(/(FROM|JOIN)\s+public\.AUX_EXPEDICION\b/i);
  });

  // Borrar transaccion alcanza al remito completo, no al circuito que la pidio: si un remito
  // mixto quedara con las filas de cocina intactas, el operario veria un remito "vaciado" que
  // sigue teniendo lecturas.
  it('borrar transaccion limpia las dos tablas de staging', async () => {
    queryPgMock.mockImplementation(
      makePgDispatcher([authRule(), { match: Markers.borrarTransaccion, handler: () => [] }]),
    );

    const res = await request(app.server)
      .delete(`/importado/${remitoId}/transaccion`)
      .send(EMPLEADO_VALIDO);

    expect(res.status).toBe(200);
    const borrados = queryPgMock.mock.calls
      .map(([s]) => String(s))
      .filter((s) => Markers.borrarTransaccion(s));
    expect(borrados).toHaveLength(2);
    expect(borrados.some((s) => Markers.borrarTransaccionCircuitos(s))).toBe(true);
    expect(borrados.some((s) => !Markers.borrarTransaccionCircuitos(s))).toBe(true);
  });

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
        { match: Markers.existeEtiqueta, handler: () => [{ etiqueta: SERIE_IMPORT }] },
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
  // El listado tambien consulta el avance por remito, para marcar los completos.
  function avanceCircuitoRule() {
    return {
      match: Markers.avanceRemitos,
      handler: () => [{ remito_id: remitoId, cantidad_escaneada: 1, cantidad_pedida: 3 }],
    };
  }

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
    queryPgMock.mockImplementation(makePgDispatcher([authRule(), listRule('PEABODY'), avanceCircuitoRule()]));

    const res = await request(app.server)
      .get('/remitos/peabody')
      .set('Authorization', basicAuthHeader());

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].tipo).toBe('PEABODY');
  });

  it('filtra por TIPO en el SQL y lee la vista de expedicion', async () => {
    queryPgMock.mockImplementation(makePgDispatcher([authRule(), listRule('IMPORT'), avanceCircuitoRule()]));

    await request(app.server).get('/remitos/importado').set('Authorization', basicAuthHeader());

    const llamada = queryPgMock.mock.calls.find((c) =>
      Markers.remitosCircuitoList(String(c[0])),
    );
    expect(llamada?.[1]).toEqual(['IMPORT']);
    // El circuito viejo sigue leyendo vp_itemremito; este NO debe tocarla.
    expect(String(llamada?.[0])).not.toContain('vp_itemremito');
  });

  it('devuelve exactMatch cuando el remitoN coincide', async () => {
    queryPgMock.mockImplementation(makePgDispatcher([authRule(), listRule('PEABODY'), avanceCircuitoRule()]));

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
