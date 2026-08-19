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

const remitoId = 'remito-1';
const etiqueta = '12345';
const tipo = 'COCINA';
const remitoN = 'R-0001';
const productoId = 'prod-1';
const itemRemitoId = 'item-1';

function authRule() {
  return { match: Markers.auth, handler: () => [{ usuario: 'JPEREZ', password: '1234' }] };
}

function baseBody(overrides: Partial<Record<string, string>> = {}) {
  return { usuario: 'jperez', password: '1234', etiqueta, tipo, remitoN, ...overrides };
}

describe('POST /despacho/:remitoId/escaneo', () => {
  const app = buildApp();

  beforeAll(async () => {
    await app.ready();
  });

  beforeEach(() => {
    queryPgMock.mockReset();
    queryMssqlMock.mockReset();
  });

  it('400 EMPTY_CODE si el codigo esta vacio', async () => {
    queryPgMock.mockImplementation(makePgDispatcher([authRule()]));

    const res = await request(app.server)
      .post(`/despacho/${remitoId}/escaneo`)
      .send(baseBody({ etiqueta: '' }));

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('EMPTY_CODE');
    expect(res.body.error.message).toBe('No se ha ingresado un código. Reintente nuevamente.');
  });

  it('409 LABEL_ALREADY_DISPATCHED si ya fue despachada', async () => {
    queryPgMock.mockImplementation(
      makePgDispatcher([
        authRule(),
        { match: Markers.ultimoEstadoEtiqueta, handler: () => [{ etiqueta, es_despacho: true }] },
      ]),
    );

    const res = await request(app.server).post(`/despacho/${remitoId}/escaneo`).send(baseBody());

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('LABEL_ALREADY_DISPATCHED');
    expect(res.body.error.message).toBe(
      'Esta etiqueta ha sido despachada previamente y no puede ser despachada nuevamente.',
    );
  });

  it('404 LABEL_NOT_FOUND si no existe en el maestro de etiquetas', async () => {
    queryPgMock.mockImplementation(
      makePgDispatcher([authRule(), { match: Markers.ultimoEstadoEtiqueta, handler: () => [] }]),
    );
    queryMssqlMock.mockImplementation(makeMssqlDispatcher([{ match: Markers.etiquetasMaestro, handler: () => [] }]));

    const res = await request(app.server).post(`/despacho/${remitoId}/escaneo`).send(baseBody());

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('LABEL_NOT_FOUND');
    expect(res.body.error.message).toBe(
      `El código ${etiqueta} no existe en la base de datos de etiquetas. Si es correcto, informe a sistemas.`,
    );
  });

  it('200 duplicated true (abort silencioso) si ya esta en staging para el remito', async () => {
    queryPgMock.mockImplementation(
      makePgDispatcher([
        authRule(),
        { match: Markers.ultimoEstadoEtiqueta, handler: () => [] },
        { match: Markers.existeEtiqueta, handler: () => [{ etiqueta }] },
      ]),
    );
    queryMssqlMock.mockImplementation(
      makeMssqlDispatcher([
        {
          match: Markers.etiquetasMaestro,
          handler: () => [{ ETIQUETA: etiqueta, TIPO: tipo, PRODUCTO_ID: productoId, PRODUCTO_N: 'Cocina X', CONTROL_FINAL: true }],
        },
      ]),
    );

    const res = await request(app.server).post(`/despacho/${remitoId}/escaneo`).send(baseBody());

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ duplicated: true });
  });

  it('422 NO_FINAL_CONTROL si el codigo no tiene control final', async () => {
    queryPgMock.mockImplementation(
      makePgDispatcher([
        authRule(),
        { match: Markers.ultimoEstadoEtiqueta, handler: () => [] },
        { match: Markers.existeEtiqueta, handler: () => [] },
      ]),
    );
    queryMssqlMock.mockImplementation(
      makeMssqlDispatcher([
        {
          match: Markers.etiquetasMaestro,
          handler: () => [{ ETIQUETA: etiqueta, TIPO: tipo, PRODUCTO_ID: productoId, PRODUCTO_N: 'Cocina X', CONTROL_FINAL: false }],
        },
      ]),
    );

    const res = await request(app.server).post(`/despacho/${remitoId}/escaneo`).send(baseBody());

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('NO_FINAL_CONTROL');
    expect(res.body.error.message).toBe(`El código ${etiqueta} NO TIENE CONTROL FINAL.`);
  });

  it('422 PRODUCT_NOT_IN_REMITO si el producto no pertenece al remito', async () => {
    queryPgMock.mockImplementation(
      makePgDispatcher([
        authRule(),
        { match: Markers.ultimoEstadoEtiqueta, handler: () => [] },
        { match: Markers.existeEtiqueta, handler: () => [] },
        { match: Markers.productosRemito, handler: () => [] },
        { match: Markers.vistaTransaccion, handler: () => [] },
      ]),
    );
    queryMssqlMock.mockImplementation(
      makeMssqlDispatcher([
        {
          match: Markers.etiquetasMaestro,
          handler: () => [{ ETIQUETA: etiqueta, TIPO: tipo, PRODUCTO_ID: productoId, PRODUCTO_N: 'Cocina X', CONTROL_FINAL: true }],
        },
      ]),
    );

    const res = await request(app.server).post(`/despacho/${remitoId}/escaneo`).send(baseBody());

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('PRODUCT_NOT_IN_REMITO');
    expect(res.body.error.message).toBe(`El código ${etiqueta} no pertenece a un producto del remito.`);
  });

  it('422 ITEM_QUOTA_REACHED si el cupo del item ya esta completo', async () => {
    queryPgMock.mockImplementation(
      makePgDispatcher([
        authRule(),
        { match: Markers.ultimoEstadoEtiqueta, handler: () => [] },
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
              producto_n: 'Cocina X',
              cantidad: 2,
              cantidad_original: 2,
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
          handler: () => [{ ETIQUETA: etiqueta, TIPO: tipo, PRODUCTO_ID: productoId, PRODUCTO_N: 'Cocina X', CONTROL_FINAL: true }],
        },
      ]),
    );

    const res = await request(app.server).post(`/despacho/${remitoId}/escaneo`).send(baseBody());

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('ITEM_QUOTA_REACHED');
    expect(res.body.error.message).toBe('Se ha alcanzado el total del item a remitir.');
  });

  it('prueba el siguiente candidato del maestro si el primero tiene cupo completo, e inserta con exito', async () => {
    const productoIdLleno = 'prod-lleno';
    const productoIdDisponible = 'prod-disponible';
    const itemLleno = 'item-lleno';
    const itemDisponible = 'item-disponible';

    queryPgMock.mockImplementation(
      makePgDispatcher([
        authRule(),
        { match: Markers.ultimoEstadoEtiqueta, handler: () => [] },
        { match: Markers.existeEtiqueta, handler: () => [] },
        {
          match: Markers.productosRemito,
          handler: () => [
            { itemremito_id: itemLleno, producto_id: productoIdLleno },
            { itemremito_id: itemDisponible, producto_id: productoIdDisponible },
          ],
        },
        {
          match: Markers.vistaTransaccion,
          handler: () => [
            {
              itemremito_id: itemLleno,
              producto_id: productoIdLleno,
              producto_n: 'Cocina Llena',
              cantidad: 2,
              cantidad_original: 2,
              cantidad_restante: 0,
            },
            {
              itemremito_id: itemDisponible,
              producto_id: productoIdDisponible,
              producto_n: 'Cocina Disponible',
              cantidad: 0,
              cantidad_original: 3,
              cantidad_restante: 3,
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
          handler: () => [
            { ETIQUETA: etiqueta, TIPO: tipo, PRODUCTO_ID: productoIdLleno, PRODUCTO_N: 'Cocina Llena', CONTROL_FINAL: true },
            { ETIQUETA: etiqueta, TIPO: tipo, PRODUCTO_ID: productoIdDisponible, PRODUCTO_N: 'Cocina Disponible', CONTROL_FINAL: true },
          ],
        },
      ]),
    );

    const res = await request(app.server).post(`/despacho/${remitoId}/escaneo`).send(baseBody());

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ success: true, productoN: 'Cocina Disponible' });
  });

  it('201 success true al insertar correctamente', async () => {
    queryPgMock.mockImplementation(
      makePgDispatcher([
        authRule(),
        { match: Markers.ultimoEstadoEtiqueta, handler: () => [] },
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
              producto_n: 'Cocina X',
              cantidad: 1,
              cantidad_original: 3,
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
          handler: () => [{ ETIQUETA: etiqueta, TIPO: tipo, PRODUCTO_ID: productoId, PRODUCTO_N: 'Cocina X', CONTROL_FINAL: true }],
        },
      ]),
    );

    const res = await request(app.server).post(`/despacho/${remitoId}/escaneo`).send(baseBody());

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      success: true,
      productoN: 'Cocina X',
      cantidadEscaneada: 1,
      cantidadRestante: 2,
      totalEscaneado: 1,
    });
  });

  it('500 SCAN_ERROR ante una excepcion no controlada durante el escaneo', async () => {
    queryPgMock.mockImplementation(
      makePgDispatcher([
        authRule(),
        { match: Markers.ultimoEstadoEtiqueta, handler: () => [] },
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
              producto_n: 'Cocina X',
              cantidad: 0,
              cantidad_original: 3,
              cantidad_restante: 3,
            },
          ],
        },
        {
          match: Markers.insertStaging,
          handler: () => {
            throw new Error('conexion perdida durante el insert');
          },
        },
      ]),
    );
    queryMssqlMock.mockImplementation(
      makeMssqlDispatcher([
        {
          match: Markers.etiquetasMaestro,
          handler: () => [{ ETIQUETA: etiqueta, TIPO: tipo, PRODUCTO_ID: productoId, PRODUCTO_N: 'Cocina X', CONTROL_FINAL: true }],
        },
      ]),
    );

    const res = await request(app.server).post(`/despacho/${remitoId}/escaneo`).send(baseBody());

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('SCAN_ERROR');
    expect(res.body.error.message).toBe(
      'Se ha producido un error al momento de registrar lectura. Reintente nuevamente.  conexion perdida durante el insert',
    );
  });

  // BUG (hallazgo QA): el Delphi original (UnitFunciones.pas linea 694) usa DOS espacios entre
  // "Reintente nuevamente." y el mensaje tecnico. La spec exige fidelidad byte a byte salvo el
  // unico punto documentado (typo "Exiten"->"Existen" en QUANTITY_MISMATCH). messages.ts (linea 40)
  // usa un solo espacio. Este test documenta el mensaje esperado segun el Delphi legado; falla
  // hoy porque src/errors/messages.ts no replica el doble espacio.
  it('[hallazgo QA] SCAN_ERROR deberia llevar doble espacio antes del mensaje tecnico (fidelidad byte a byte con UnitFunciones.pas:694)', async () => {
    queryPgMock.mockImplementation(
      makePgDispatcher([
        authRule(),
        { match: Markers.ultimoEstadoEtiqueta, handler: () => [] },
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
              producto_n: 'Cocina X',
              cantidad: 0,
              cantidad_original: 3,
              cantidad_restante: 3,
            },
          ],
        },
        {
          match: Markers.insertStaging,
          handler: () => {
            throw new Error('conexion perdida durante el insert');
          },
        },
      ]),
    );
    queryMssqlMock.mockImplementation(
      makeMssqlDispatcher([
        {
          match: Markers.etiquetasMaestro,
          handler: () => [{ ETIQUETA: etiqueta, TIPO: tipo, PRODUCTO_ID: productoId, PRODUCTO_N: 'Cocina X', CONTROL_FINAL: true }],
        },
      ]),
    );

    const res = await request(app.server).post(`/despacho/${remitoId}/escaneo`).send(baseBody());

    expect(res.status).toBe(500);
    // Doble espacio literal, tal cual el Delphi original: 'nuevamente.' + '  ' + E.Message.
    expect(res.body.error.message).toBe(
      'Se ha producido un error al momento de registrar lectura. Reintente nuevamente.  conexion perdida durante el insert',
    );
  });

  describe('orden de validaciones: colisiones', () => {
    it('paso 4 (duplicado) gana sobre paso 5 (CONTROL_FINAL) cuando ambas condiciones aplican', async () => {
      // Etiqueta ya en staging del remito Y sin control final: debe abortar en silencio (200
      // duplicated), nunca 422 NO_FINAL_CONTROL, porque el duplicado se chequea primero (paso 4 < paso 5).
      queryPgMock.mockImplementation(
        makePgDispatcher([
          authRule(),
          { match: Markers.ultimoEstadoEtiqueta, handler: () => [] },
          { match: Markers.existeEtiqueta, handler: () => [{ etiqueta }] },
        ]),
      );
      queryMssqlMock.mockImplementation(
        makeMssqlDispatcher([
          {
            match: Markers.etiquetasMaestro,
            handler: () => [
              { ETIQUETA: etiqueta, TIPO: tipo, PRODUCTO_ID: productoId, PRODUCTO_N: 'Cocina X', CONTROL_FINAL: false },
            ],
          },
        ]),
      );

      const res = await request(app.server).post(`/despacho/${remitoId}/escaneo`).send(baseBody());

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ duplicated: true });
    });

    it('paso 2 (ya despachada) gana sobre paso 4 (duplicado) cuando ambas condiciones aplican', async () => {
      // Etiqueta ya despachada globalmente (paso 2) Y tambien presente en staging del remito
      // (seria "duplicada" en paso 4): debe cortar en el paso 2 con 409, sin llegar a evaluar
      // el duplicado, porque el paso 2 va antes en el orden documentado.
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
            handler: () => [
              { ETIQUETA: etiqueta, TIPO: tipo, PRODUCTO_ID: productoId, PRODUCTO_N: 'Cocina X', CONTROL_FINAL: true },
            ],
          },
        ]),
      );

      const res = await request(app.server).post(`/despacho/${remitoId}/escaneo`).send(baseBody());

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('LABEL_ALREADY_DISPATCHED');
      // El maestro (paso 3) ni siquiera deberia consultarse si el paso 2 ya corta.
      expect(queryMssqlMock).not.toHaveBeenCalled();
    });

    it('paso 5 (CONTROL_FINAL) gana sobre paso 6/7 (producto no pertenece al remito)', async () => {
      queryPgMock.mockImplementation(
        makePgDispatcher([
          authRule(),
          { match: Markers.ultimoEstadoEtiqueta, handler: () => [] },
          { match: Markers.existeEtiqueta, handler: () => [] },
        ]),
      );
      queryMssqlMock.mockImplementation(
        makeMssqlDispatcher([
          {
            match: Markers.etiquetasMaestro,
            handler: () => [
              { ETIQUETA: etiqueta, TIPO: tipo, PRODUCTO_ID: productoId, PRODUCTO_N: 'Cocina X', CONTROL_FINAL: false },
            ],
          },
        ]),
      );

      const res = await request(app.server).post(`/despacho/${remitoId}/escaneo`).send(baseBody());

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('NO_FINAL_CONTROL');
    });
  });

  describe('body malformado / campos faltantes / tipos incorrectos', () => {
    it('body vacio ({}) cae en EMPTY_CODE (etiqueta ausente se normaliza a cadena vacia)', async () => {
      queryPgMock.mockImplementation(makePgDispatcher([authRule()]));

      const res = await request(app.server).post(`/despacho/${remitoId}/escaneo`).send({});

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('EMPTY_CODE');
    });

    it('etiqueta con tipo incorrecto (numero en vez de string) se normaliza a vacio -> EMPTY_CODE', async () => {
      queryPgMock.mockImplementation(makePgDispatcher([authRule()]));

      const res = await request(app.server)
        .post(`/despacho/${remitoId}/escaneo`)
        .send({ usuario: 'jperez', password: '1234', etiqueta: 12345, tipo, remitoN });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('EMPTY_CODE');
    });

    it('400 INVALID_REQUEST si el body no es un objeto (array JSON)', async () => {
      queryPgMock.mockImplementation(makePgDispatcher([authRule()]));

      const res = await request(app.server)
        .post(`/despacho/${remitoId}/escaneo`)
        .set('Content-Type', 'application/json')
        .send('[1,2,3]');

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_REQUEST');
    });
  });
});
